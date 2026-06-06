use std::collections::HashMap;
use ssh2::Session;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct SshMasterConnection {
    pub session_id: String,
    pub session: Session,
    pub active_channels: u32,
}

pub struct NexusConnectionPool {
    pub pool: Arc<Mutex<HashMap<String, SshMasterConnection>>>,
}

impl NexusConnectionPool {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Master connection initiation with Legacy Fallback
    pub async fn connect(&self, session_id: String, host: &str, port: u16, username: &str, password: Option<&str>) -> Result<(), String> {
        let tcp = std::net::TcpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| format!("Failed to connect to TCP: {}", e))?;
        
        let mut session = Session::new().map_err(|e| e.to_string())?;
        session.set_tcp_stream(tcp);
        
        // ==========================================
        // 祖传设备兼容性 (Legacy Fallback 机制)
        // 确保连接旧版 CentOS, Cisco, Huawei 不会失败
        // ==========================================
        
        // 1. 密钥交换算法 (KEX)
        let kex = "curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,diffie-hellman-group-exchange-sha256,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512,diffie-hellman-group14-sha256,diffie-hellman-group14-sha1,diffie-hellman-group1-sha1";
        let _ = session.method_pref(ssh2::MethodType::Kex, kex);
        
        // 2. 加密算法 (Cipher)
        let cipher = "chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes256-cbc,aes192-cbc,aes128-cbc,3des-cbc";
        let _ = session.method_pref(ssh2::MethodType::CryptCs, cipher);
        let _ = session.method_pref(ssh2::MethodType::CryptSc, cipher);
        
        // 3. 主机密钥算法 (HostKey)
        let hostkey = "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,rsa-sha2-512,rsa-sha2-256,ssh-rsa,ssh-dss";
        let _ = session.method_pref(ssh2::MethodType::HostKey, hostkey);

        // 发起握手
        session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // 认证
        if let Some(pwd) = password {
            session.userauth_password(username, pwd).map_err(|e| format!("Password auth failed: {}", e))?;
        }
        
        if !session.authenticated() {
            return Err("Authentication failed".into());
        }

        let master = SshMasterConnection {
            session_id: session_id.clone(),
            session,
            active_channels: 0,
        };

        self.pool.lock().await.insert(session_id, master);
        Ok(())
    }

    /// Core capability: 0-delay multiplexing fission
    /// Requests a new channel and PTY without opening a new TCP connection
    pub async fn split_fission(&self, session_id: &str) -> Result<ssh2::Channel, String> {
        let pool = self.pool.lock().await;
        if let Some(master) = pool.get(session_id) {
            match master.session.channel_session() {
                Ok(mut channel) => {
                    // Instantly spawn new PTY over existing connection
                    channel.request_pty("xterm", None, None).map_err(|e| e.to_string())?;
                    channel.shell().map_err(|e| e.to_string())?;
                    Ok(channel)
                }
                Err(e) => Err(format!("Failed to open new multiplexed channel: {}", e)),
            }
        } else {
            Err(format!("Session {} not found in master pool", session_id))
        }
    }
}
