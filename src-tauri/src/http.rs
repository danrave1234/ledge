use std::sync::OnceLock;
use std::time::Duration;

/// Shared HTTP client.
///
/// One client for the whole process: `reqwest::Client` owns a connection pool,
/// so building one per request threw away pooled TLS connections and paid a
/// fresh handshake every time.
///
/// Timeouts are deliberate. A streamed chat completion can legitimately take
/// minutes, so there is NO overall request timeout — only a connect timeout and
/// a read timeout, which bound "the server stopped responding" without killing a
/// slow-but-alive generation.
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub const USER_AGENT: &str = concat!("Perch/", env!("CARGO_PKG_VERSION"));

pub fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(90))
            .pool_idle_timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// Client for short request/response calls, where a total timeout IS correct
/// (model list, web search). Shares the pool above via the same builder config.
static QUICK: OnceLock<reqwest::Client> = OnceLock::new();

pub fn quick_client() -> &'static reqwest::Client {
    QUICK.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}
