pub mod ffmpeg;
pub mod subtitles;

use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    task::{Context, Poll},
};

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures::Stream;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt};
use tokio_util::io::ReaderStream;

const CHUNK: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64, // inclusive
}

/// Parse a single `Range: bytes=` header against a resource of `len` bytes.
pub fn parse_range(headers: &HeaderMap, len: u64) -> Result<Option<ByteRange>, ()> {
    let Some(value) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) else {
        return Ok(None);
    };
    let spec = value.strip_prefix("bytes=").ok_or(())?;
    // Only the first range is honoured; browsers never ask for several.
    let first = spec.split(',').next().ok_or(())?.trim();
    let (a, b) = first.split_once('-').ok_or(())?;
    if len == 0 {
        return Err(());
    }
    let range = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().map_err(|_| ())?;
            if n == 0 {
                return Err(());
            }
            ByteRange { start: len.saturating_sub(n), end: len - 1 }
        }
        (start, "") => {
            let s: u64 = start.parse().map_err(|_| ())?;
            ByteRange { start: s, end: len - 1 }
        }
        (start, end) => {
            let s: u64 = start.parse().map_err(|_| ())?;
            let e: u64 = end.parse().map_err(|_| ())?;
            ByteRange { start: s, end: e.min(len - 1) }
        }
    };
    if range.start > range.end || range.start >= len {
        return Err(());
    }
    Ok(Some(range))
}

/// Counts bytes passing through a body stream and reports the total once the
/// stream is dropped (finished or client went away).
pub struct CountingStream<S> {
    inner: S,
    counter: Arc<AtomicU64>,
    _guard: Option<Box<dyn Send + Sync>>,
}

impl<S> CountingStream<S> {
    pub fn new(inner: S, counter: Arc<AtomicU64>, guard: Option<Box<dyn Send + Sync>>) -> Self {
        Self { inner, counter, _guard: guard }
    }
}

impl<S> Stream for CountingStream<S>
where
    S: Stream<Item = std::io::Result<Bytes>> + Unpin,
{
    type Item = std::io::Result<Bytes>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let res = Pin::new(&mut self.inner).poll_next(cx);
        if let Poll::Ready(Some(Ok(b))) = &res {
            self.counter.fetch_add(b.len() as u64, Ordering::Relaxed);
        }
        res
    }
}

/// Serve a seekable reader with HTTP range support. `guard` is kept alive
/// for as long as the body is being sent (e.g. a torrent lease).
pub async fn serve_reader<R>(
    mut reader: R,
    len: u64,
    content_type: &str,
    headers: &HeaderMap,
    counter: Arc<AtomicU64>,
    guard: Option<Box<dyn Send + Sync>>,
) -> Response
where
    R: AsyncRead + AsyncSeek + Unpin + Send + 'static,
{
    let range = match parse_range(headers, len) {
        Ok(r) => r,
        Err(()) => {
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{len}"))],
            )
                .into_response();
        }
    };

    let (status, start, end) = match range {
        Some(r) => (StatusCode::PARTIAL_CONTENT, r.start, r.end),
        None => (StatusCode::OK, 0, len.saturating_sub(1)),
    };
    let body_len = if len == 0 { 0 } else { end - start + 1 };

    if start > 0
        && let Err(e) = reader.seek(std::io::SeekFrom::Start(start)).await
    {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("seek failed: {e}")).into_response();
    }

    let stream = ReaderStream::with_capacity(reader.take(body_len), CHUNK);
    let body = Body::from_stream(CountingStream::new(stream, counter, guard));

    let mut res = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body_len)
        .header(header::CACHE_CONTROL, "no-store");
    if status == StatusCode::PARTIAL_CONTENT {
        res = res.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    res.body(body).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub fn mime_for(path: &str) -> HeaderValue {
    let guess = match crate::torrents::parser::extension(path).as_deref() {
        Some("mkv") => "video/x-matroska".to_string(),
        Some("mp4" | "m4v") => "video/mp4".to_string(),
        Some("webm") => "video/webm".to_string(),
        Some("mov") => "video/quicktime".to_string(),
        Some("avi") => "video/x-msvideo".to_string(),
        Some("ts" | "m2ts") => "video/mp2t".to_string(),
        _ => mime_guess::from_path(path).first_or_octet_stream().to_string(),
    };
    HeaderValue::from_str(&guess).unwrap_or(HeaderValue::from_static("application/octet-stream"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(v: &str) -> HeaderMap {
        let mut m = HeaderMap::new();
        m.insert(header::RANGE, v.parse().unwrap());
        m
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range(&HeaderMap::new(), 100), Ok(None));
        assert_eq!(parse_range(&h("bytes=0-"), 100), Ok(Some(ByteRange { start: 0, end: 99 })));
        assert_eq!(parse_range(&h("bytes=10-19"), 100), Ok(Some(ByteRange { start: 10, end: 19 })));
        assert_eq!(parse_range(&h("bytes=-10"), 100), Ok(Some(ByteRange { start: 90, end: 99 })));
        assert_eq!(parse_range(&h("bytes=50-500"), 100), Ok(Some(ByteRange { start: 50, end: 99 })));
        assert!(parse_range(&h("bytes=100-"), 100).is_err());
        assert!(parse_range(&h("items=0-1"), 100).is_err());
    }
}
