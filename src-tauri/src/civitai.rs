use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchImagesParams {
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    pub sort: Option<String>,
    pub period: Option<String>,
    pub nsfw: Option<String>,
    pub username: Option<String>,
    pub model_id: Option<i64>,
    pub model_version_id: Option<i64>,
    pub base_models: Option<String>,
    pub tags: Option<String>,
    pub api_token: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImagesResponse {
    pub items: Vec<serde_json::Value>,
    pub metadata: Option<ResponseMetadata>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMetadata {
    pub next_cursor: Option<String>,
    pub next_page: Option<String>,
    pub current_page: Option<u32>,
    pub page_size: Option<u32>,
    pub total_items: Option<u64>,
    pub total_pages: Option<u32>,
}

pub struct DownloadedFile {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("CivitaiBrowser/0.1.0")
            .pool_max_idle_per_host(16)
            .tcp_keepalive(Duration::from_secs(30))
            .timeout(Duration::from_secs(45))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build HTTP client")
    })
}

pub async fn fetch_images(params: FetchImagesParams) -> AppResult<ImagesResponse> {
    let client = http_client();
    let mut query: HashMap<String, String> = HashMap::new();

    query.insert("withMeta".into(), "true".into());
    query.insert("type".into(), "image".into());
    query.insert(
        "limit".into(),
        params.limit.unwrap_or(100).clamp(1, 200).to_string(),
    );

    if let Some(cursor) = params.cursor.filter(|c| !c.is_empty()) {
        query.insert("cursor".into(), cursor);
    }
    if let Some(sort) = params.sort.filter(|s| !s.is_empty()) {
        query.insert("sort".into(), sort);
    }
    if let Some(period) = params.period.filter(|p| !p.is_empty()) {
        query.insert("period".into(), period);
    }
    if let Some(nsfw) = params.nsfw.filter(|n| !n.is_empty()) {
        query.insert("nsfw".into(), nsfw);
    }
    if let Some(username) = params.username.filter(|u| !u.is_empty()) {
        query.insert("username".into(), username);
    }
    if let Some(model_id) = params.model_id {
        query.insert("modelId".into(), model_id.to_string());
    }
    if let Some(model_version_id) = params.model_version_id {
        query.insert("modelVersionId".into(), model_version_id.to_string());
    }
    if let Some(base_models) = params.base_models.filter(|b| !b.is_empty()) {
        query.insert("baseModels".into(), base_models);
    }
    if let Some(tags) = params.tags.filter(|t| !t.is_empty()) {
        query.insert("tags".into(), tags);
    }

    let mut request = client
        .get("https://civitai.com/api/v1/images")
        .query(&query);

    if let Some(token) = params.api_token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }

    let response = request.send().await?;
    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(AppError::Message(format!(
            "Civitai API error {status}: {body}"
        )));
    }

    let parsed: ImagesResponse = serde_json::from_str(&body)?;
    Ok(parsed)
}

pub async fn download_file(url: &str, api_token: Option<&str>) -> AppResult<DownloadedFile> {
    let client = http_client();
    let mut request = client.get(url);
    if let Some(token) = api_token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    let response = request.send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Message(format!(
            "Download failed with status {status}"
        )));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());
    let bytes = response.bytes().await?.to_vec();
    Ok(DownloadedFile {
        bytes,
        content_type,
    })
}
