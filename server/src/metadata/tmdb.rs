use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use dashmap::DashMap;
use serde_json::Value;

use super::{
    CastMember, EpisodeInfo, MediaDetails, MediaKind, SearchItem, SeasonSummary, year_of,
};

const BASE: &str = "https://api.themoviedb.org/3";
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);

pub struct Tmdb {
    http: reqwest::Client,
    cache: DashMap<String, (Instant, Value)>,
}

impl Tmdb {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            cache: DashMap::new(),
        }
    }

    async fn get(&self, key: &str, path: &str, query: &[(&str, String)]) -> anyhow::Result<Value> {
        let mut url = url::Url::parse(&format!("{BASE}{path}"))?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("api_key", key);
            for (k, v) in query {
                q.append_pair(k, v);
            }
        }
        let cache_key = url.as_str().to_string();
        if let Some(hit) = self.cache.get(&cache_key)
            && hit.0.elapsed() < CACHE_TTL
        {
            return Ok(hit.1.clone());
        }

        let res = self
            .http
            .get(url)
            .send()
            .await
            .context("contacting TMDB")?;
        let status = res.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            bail!("TMDB rejected the API key");
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            bail!("not found on TMDB");
        }
        if !status.is_success() {
            bail!("TMDB returned {status}");
        }
        let body: Value = res.json().await.context("decoding TMDB response")?;
        if self.cache.len() > 2000 {
            self.cache.retain(|_, v| v.0.elapsed() < CACHE_TTL);
        }
        self.cache.insert(cache_key, (Instant::now(), body.clone()));
        Ok(body)
    }

    /// Check that a key is accepted.
    pub async fn validate_key(&self, key: &str) -> anyhow::Result<()> {
        self.get(key, "/configuration", &[]).await.map(|_| ())
    }

    pub async fn search(
        &self,
        key: &str,
        lang: &str,
        query: &str,
        kind: Option<MediaKind>,
        page: u32,
    ) -> anyhow::Result<Page> {
        let path = match kind {
            Some(MediaKind::Movie) => "/search/movie",
            Some(MediaKind::Tv) => "/search/tv",
            None => "/search/multi",
        };
        let body = self
            .get(
                key,
                path,
                &[
                    ("query", query.to_string()),
                    ("language", lang.to_string()),
                    ("page", page.to_string()),
                    ("include_adult", "false".into()),
                ],
            )
            .await?;
        Ok(parse_page(&body, kind))
    }

    /// Lists for the discover page: `trending`, `popular`, `top_rated`,
    /// `upcoming` (movies), `on_the_air` (tv), `now_playing` (movies).
    pub async fn list(
        &self,
        key: &str,
        lang: &str,
        kind: MediaKind,
        list: &str,
        page: u32,
    ) -> anyhow::Result<Page> {
        let path = match (list, kind) {
            ("trending", k) => format!("/trending/{}/week", k.as_str()),
            ("popular" | "top_rated" | "upcoming" | "now_playing", MediaKind::Movie) => {
                format!("/movie/{list}")
            }
            ("popular" | "top_rated" | "on_the_air" | "airing_today", MediaKind::Tv) => {
                format!("/tv/{list}")
            }
            _ => bail!("unknown list {list}"),
        };
        let body = self
            .get(
                key,
                &path,
                &[("language", lang.to_string()), ("page", page.to_string())],
            )
            .await?;
        Ok(parse_page(&body, Some(kind)))
    }

    pub async fn discover_genre(
        &self,
        key: &str,
        lang: &str,
        kind: MediaKind,
        genre: i64,
        page: u32,
    ) -> anyhow::Result<Page> {
        let body = self
            .get(
                key,
                &format!("/discover/{}", kind.as_str()),
                &[
                    ("language", lang.to_string()),
                    ("page", page.to_string()),
                    ("with_genres", genre.to_string()),
                    ("sort_by", "popularity.desc".into()),
                ],
            )
            .await?;
        Ok(parse_page(&body, Some(kind)))
    }

    pub async fn genres(&self, key: &str, lang: &str, kind: MediaKind) -> anyhow::Result<Vec<(i64, String)>> {
        let body = self
            .get(
                key,
                &format!("/genre/{}/list", kind.as_str()),
                &[("language", lang.to_string())],
            )
            .await?;
        Ok(body["genres"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|g| Some((g["id"].as_i64()?, g["name"].as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn details(
        &self,
        key: &str,
        lang: &str,
        kind: MediaKind,
        id: i64,
    ) -> anyhow::Result<MediaDetails> {
        let short_lang = lang.split('-').next().unwrap_or("en").to_string();
        let append = match kind {
            MediaKind::Movie => "credits,videos,release_dates,external_ids,images",
            MediaKind::Tv => "credits,videos,content_ratings,external_ids,images",
        };
        let v = self
            .get(
                key,
                &format!("/{}/{id}", kind.as_str()),
                &[
                    ("language", lang.to_string()),
                    ("append_to_response", append.into()),
                    ("include_image_language", format!("{short_lang},en,null")),
                ],
            )
            .await?;

        let title_key = if kind == MediaKind::Movie { "title" } else { "name" };
        let orig_key = if kind == MediaKind::Movie {
            "original_title"
        } else {
            "original_name"
        };
        let date_key = if kind == MediaKind::Movie {
            "release_date"
        } else {
            "first_air_date"
        };
        let release_date = str_opt(&v[date_key]);

        let runtime = match kind {
            MediaKind::Movie => v["runtime"].as_i64(),
            MediaKind::Tv => v["episode_run_time"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|r| r.as_i64())
                .or_else(|| v["last_episode_to_air"]["runtime"].as_i64()),
        };

        let certification = match kind {
            MediaKind::Movie => v["release_dates"]["results"].as_array().and_then(|r| {
                let us = r.iter().find(|c| c["iso_3166_1"] == "US")?;
                us["release_dates"]
                    .as_array()?
                    .iter()
                    .filter_map(|d| d["certification"].as_str())
                    .find(|c| !c.is_empty())
                    .map(String::from)
            }),
            MediaKind::Tv => v["content_ratings"]["results"].as_array().and_then(|r| {
                r.iter()
                    .find(|c| c["iso_3166_1"] == "US")
                    .and_then(|c| str_opt(&c["rating"]))
            }),
        };

        let genres = names(&v["genres"]);
        let networks = match kind {
            MediaKind::Movie => names(&v["production_companies"]).into_iter().take(3).collect(),
            MediaKind::Tv => names(&v["networks"]),
        };

        let cast = v["credits"]["cast"]
            .as_array()
            .map(|a| {
                a.iter()
                    .take(15)
                    .filter_map(|c| {
                        Some(CastMember {
                            name: c["name"].as_str()?.to_string(),
                            character: str_opt(&c["character"]),
                            profile_path: str_opt(&c["profile_path"]),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let trailer_key = v["videos"]["results"].as_array().and_then(|vids| {
            let youtube = |t: &str| {
                vids.iter().find(|x| {
                    x["site"] == "YouTube" && x["type"] == t && x["official"].as_bool() != Some(false)
                })
            };
            youtube("Trailer")
                .or_else(|| youtube("Teaser"))
                .and_then(|x| str_opt(&x["key"]))
        });

        let logo_path = v["images"]["logos"].as_array().and_then(|logos| {
            logos
                .iter()
                .find(|l| l["iso_639_1"].as_str() == Some(short_lang.as_str()))
                .or_else(|| logos.iter().find(|l| l["iso_639_1"] == "en"))
                .or_else(|| logos.first())
                .and_then(|l| str_opt(&l["file_path"]))
        });

        let seasons = v["seasons"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|s| {
                        Some(SeasonSummary {
                            season_number: s["season_number"].as_i64()?,
                            name: str_opt(&s["name"]),
                            overview: str_opt(&s["overview"]),
                            poster_path: str_opt(&s["poster_path"]),
                            air_date: str_opt(&s["air_date"]),
                            episode_count: s["episode_count"].as_i64().unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(MediaDetails {
            kind,
            tmdb_id: id,
            tvdb_id: v["external_ids"]["tvdb_id"].as_i64(),
            imdb_id: str_opt(&v["external_ids"]["imdb_id"]).or_else(|| str_opt(&v["imdb_id"])),
            title: v[title_key].as_str().unwrap_or("Untitled").to_string(),
            original_title: str_opt(&v[orig_key]),
            overview: str_opt(&v["overview"]),
            tagline: str_opt(&v["tagline"]),
            status: str_opt(&v["status"]),
            year: year_of(release_date.as_deref()),
            release_date,
            runtime,
            rating: v["vote_average"].as_f64(),
            vote_count: v["vote_count"].as_i64(),
            certification,
            original_language: str_opt(&v["original_language"]),
            genres,
            networks,
            cast,
            poster_path: str_opt(&v["poster_path"]),
            backdrop_path: str_opt(&v["backdrop_path"]),
            logo_path,
            trailer_key,
            seasons,
        })
    }

    pub async fn season(
        &self,
        key: &str,
        lang: &str,
        tv_id: i64,
        season: i64,
    ) -> anyhow::Result<Vec<EpisodeInfo>> {
        let v = self
            .get(
                key,
                &format!("/tv/{tv_id}/season/{season}"),
                &[("language", lang.to_string())],
            )
            .await?;
        Ok(v["episodes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|e| {
                        Some(EpisodeInfo {
                            season_number: e["season_number"].as_i64().unwrap_or(season),
                            episode_number: e["episode_number"].as_i64()?,
                            absolute_number: None,
                            name: str_opt(&e["name"]),
                            overview: str_opt(&e["overview"]),
                            still_path: str_opt(&e["still_path"]),
                            air_date: str_opt(&e["air_date"]),
                            runtime: e["runtime"].as_i64(),
                            rating: e["vote_average"].as_f64(),
                            tmdb_id: e["id"].as_i64(),
                            tvdb_id: None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Page {
    pub page: i64,
    pub total_pages: i64,
    pub total_results: i64,
    pub results: Vec<SearchItem>,
}

fn parse_page(body: &Value, kind: Option<MediaKind>) -> Page {
    let results = body["results"]
        .as_array()
        .map(|a| a.iter().filter_map(|r| parse_item(r, kind)).collect())
        .unwrap_or_default();
    Page {
        page: body["page"].as_i64().unwrap_or(1),
        total_pages: body["total_pages"].as_i64().unwrap_or(1),
        total_results: body["total_results"].as_i64().unwrap_or(0),
        results,
    }
}

fn parse_item(r: &Value, kind: Option<MediaKind>) -> Option<SearchItem> {
    let kind = match kind {
        Some(k) => k,
        None => MediaKind::parse(r["media_type"].as_str()?)?,
    };
    let (title, orig, date) = match kind {
        MediaKind::Movie => ("title", "original_title", "release_date"),
        MediaKind::Tv => ("name", "original_name", "first_air_date"),
    };
    let release_date = str_opt(&r[date]);
    Some(SearchItem {
        kind,
        tmdb_id: r["id"].as_i64()?,
        title: r[title].as_str()?.to_string(),
        original_title: str_opt(&r[orig]),
        overview: str_opt(&r["overview"]),
        year: year_of(release_date.as_deref()),
        release_date,
        poster_path: str_opt(&r["poster_path"]),
        backdrop_path: str_opt(&r["backdrop_path"]),
        rating: r["vote_average"].as_f64(),
        vote_count: r["vote_count"].as_i64(),
        popularity: r["popularity"].as_f64(),
        genre_ids: r["genre_ids"]
            .as_array()
            .map(|a| a.iter().filter_map(|g| g.as_i64()).collect())
            .unwrap_or_default(),
    })
}

fn str_opt(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(String::from)
}

fn names(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}
