//! Metadata providers. TMDB is the primary source for everything; TVDB is
//! used to fill gaps for shows (missing episode lists, absolute numbering
//! which many anime releases use).

pub mod tmdb;
pub mod tvdb;

use serde::{Deserialize, Serialize};

use crate::settings::Settings;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase", type_name = "TEXT")]
pub enum MediaKind {
    Movie,
    Tv,
}

impl MediaKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Tv => "tv",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "movie" => Some(Self::Movie),
            "tv" | "show" | "series" => Some(Self::Tv),
            _ => None,
        }
    }
}

/// A search/discover result, independent of whether it's in the library.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchItem {
    pub kind: MediaKind,
    pub tmdb_id: i64,
    pub title: String,
    pub original_title: Option<String>,
    pub overview: Option<String>,
    pub year: Option<i64>,
    pub release_date: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub rating: Option<f64>,
    pub vote_count: Option<i64>,
    pub popularity: Option<f64>,
    pub genre_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastMember {
    pub name: String,
    pub character: Option<String>,
    pub profile_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonSummary {
    pub season_number: i64,
    pub name: Option<String>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub air_date: Option<String>,
    pub episode_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeInfo {
    pub season_number: i64,
    pub episode_number: i64,
    pub absolute_number: Option<i64>,
    pub name: Option<String>,
    pub overview: Option<String>,
    pub still_path: Option<String>,
    pub air_date: Option<String>,
    pub runtime: Option<i64>,
    pub rating: Option<f64>,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetails {
    pub kind: MediaKind,
    pub tmdb_id: i64,
    pub tvdb_id: Option<i64>,
    pub imdb_id: Option<String>,
    pub title: String,
    pub original_title: Option<String>,
    pub overview: Option<String>,
    pub tagline: Option<String>,
    pub status: Option<String>,
    pub release_date: Option<String>,
    pub year: Option<i64>,
    pub runtime: Option<i64>,
    pub rating: Option<f64>,
    pub vote_count: Option<i64>,
    pub certification: Option<String>,
    pub original_language: Option<String>,
    pub genres: Vec<String>,
    pub networks: Vec<String>,
    pub cast: Vec<CastMember>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub logo_path: Option<String>,
    pub trailer_key: Option<String>,
    pub seasons: Vec<SeasonSummary>,
}

pub struct Metadata {
    pub tmdb: tmdb::Tmdb,
    pub tvdb: tvdb::Tvdb,
}

impl Metadata {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            tmdb: tmdb::Tmdb::new(http.clone()),
            tvdb: tvdb::Tvdb::new(http),
        }
    }

    /// Fetch every episode of a show. TMDB first; if it has nothing for a
    /// season (or the show), fall back to TVDB. Absolute numbers are
    /// borrowed from TVDB when available.
    pub async fn all_episodes(
        &self,
        settings: &Settings,
        details: &MediaDetails,
    ) -> anyhow::Result<Vec<EpisodeInfo>> {
        let lang = settings.language().await;
        let tmdb_key = settings.tmdb_api_key().await;
        let mut episodes = Vec::new();
        for season in &details.seasons {
            match self
                .tmdb
                .season(&tmdb_key, &lang, details.tmdb_id, season.season_number)
                .await
            {
                Ok(eps) => episodes.extend(eps),
                Err(e) => tracing::warn!(
                    tmdb_id = details.tmdb_id,
                    season = season.season_number,
                    error = %e,
                    "failed to fetch season from TMDB"
                ),
            }
        }

        let Some(tvdb_id) = details.tvdb_id else {
            return Ok(episodes);
        };
        let tvdb_key = settings.tvdb_api_key().await;
        let tvdb_eps = match self.tvdb.episodes(&tvdb_key, tvdb_id).await {
            Ok(eps) => eps,
            Err(e) => {
                tracing::warn!(tvdb_id, error = %e, "TVDB episode lookup failed");
                return Ok(episodes);
            }
        };

        // Fill absolute numbers and TVDB ids for episodes we already have.
        for ep in episodes.iter_mut() {
            if let Some(t) = tvdb_eps.iter().find(|t| {
                t.season_number == ep.season_number && t.episode_number == ep.episode_number
            }) {
                ep.absolute_number = ep.absolute_number.or(t.absolute_number);
                ep.tvdb_id = t.tvdb_id;
            }
        }
        // Add anything TMDB didn't know about.
        for t in tvdb_eps {
            let known = episodes.iter().any(|e| {
                e.season_number == t.season_number && e.episode_number == t.episode_number
            });
            if !known {
                episodes.push(t);
            }
        }
        episodes.sort_by_key(|e| (e.season_number, e.episode_number));
        Ok(episodes)
    }
}

pub fn year_of(date: Option<&str>) -> Option<i64> {
    date.and_then(|d| d.get(0..4)).and_then(|y| y.parse().ok())
}
