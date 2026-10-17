//! Bounded requests to the current socket/child, with delivery acknowledgement.
use super::*;
use tokio::sync::{mpsc, oneshot};
pub struct Request {
    pub body: Value,
    pub reply: oneshot::Sender<Result<()>>,
}
impl Channels {
    pub(super) fn register(&self, platform: &str, cfg: &ChannelConfig) -> mpsc::Receiver<Request> {
        let (tx, rx) = mpsc::channel(32);
        self.live
            .lock()
            .unwrap()
            .insert(platform.into(), (cfg.generation.clone(), tx));
        rx
    }
    pub(super) async fn send_live(
        &self,
        platform: &str,
        cfg: &ChannelConfig,
        body: Value,
    ) -> Result<()> {
        let tx = self
            .live
            .lock()
            .unwrap()
            .get(platform)
            .filter(|(secret, _)| secret == &cfg.generation)
            .map(|(_, tx)| tx.clone())
            .ok_or_else(|| anyhow::anyhow!("platform is not connected"))?;
        let (reply, result) = oneshot::channel();
        tx.try_send(Request { body, reply })
            .map_err(|_| anyhow::anyhow!("platform is disconnected or busy"))?;
        tokio::time::timeout(Duration::from_secs(30), result)
            .await
            .map_err(|_| {
                anyhow::anyhow!("delivery acknowledgement timed out; do not retry automatically")
            })?
            .map_err(|_| anyhow::anyhow!("connection ended before delivery acknowledgement"))?
    }
}
