import * as os from 'os';
import * as path from 'path';

// Note: Ensure `@lancedb/lancedb` is installed via package.json before executing.
import * as lancedb from '@lancedb/lancedb';

/**
 * 严格落实《Workspace 2.0 架构提案》第 3.1 节：智能体记忆隔离层
 * 封装 LanceDB 向量数据库的核心管理逻辑，确保内存数据与物理工作区的绝对隔离。
 */
export class RagManager {
  private static db: lancedb.Connection | null = null;
  private static currentWorkspaceId: string | null = null;

  /**
   * 动态沙箱连接 (Dynamic Sandbox Connection)
   * 必须挂载到 ~/.getssh/<workspaceId>/ai_context/lancedb/ 确保物理隔离
   * @param workspaceId 当前激活的工作区 ID
   */
  public static async connectWorkspaceDB(workspaceId: string): Promise<void> {
    if (this.currentWorkspaceId === workspaceId && this.db) {
      console.log(`[RagManager] Already securely connected to workspace sandbox: ${workspaceId}`);
      return;
    }

    // 切换前必须执行原子级销毁，杜绝哪怕一毫秒的 RAG 上下文污染
    if (this.db) {
      await this.disconnectCurrentDB();
    }

    try {
      const dbPath = path.join(os.homedir(), '.getssh', workspaceId, 'ai_context', 'lancedb');
      
      console.log(`[RagManager] Mounting LanceDB engine at isolated sandbox: ${dbPath}`);
      this.db = await lancedb.connect(dbPath);
      this.currentWorkspaceId = workspaceId;

      // 连接成功后，立即检查并执行基础 Schema 初始化
      await this.bootstrapSchema();
    } catch (error) {
      console.error(`[RagManager] Critical failure while mounting LanceDB for workspace ${workspaceId}:`, error);
      this.db = null;
      this.currentWorkspaceId = null;
      throw error;
    }
  }

  /**
   * 原子级实例销毁 (Zero-Out Destruction)
   * 彻底清空当前数据库连接与内存句柄
   */
  public static async disconnectCurrentDB(): Promise<void> {
    if (this.db) {
      console.log(`[RagManager] Initiating Zero-Out destruction for workspace ${this.currentWorkspaceId}...`);
      
      try {
        // 部分版本的客户端可能未实现完整的 close()，我们尽力调用
        if (typeof (this.db as any).close === 'function') {
           await (this.db as any).close();
        }
      } catch (e) {
        console.warn('[RagManager] Non-fatal error during DB handle closure:', e);
      }
      
      // 强制内存句柄清零，触发 V8 垃圾回收
      this.db = null;
      this.currentWorkspaceId = null;
      console.log('[RagManager] Database connection completely destroyed. RAG memory neutralized.');
    }
  }

  /**
   * 基础 RAG 表初始化 (Schema Bootstrap)
   * 初始化名为 `ops_logs` 的向量表，用于存储运维日志和报错上下文
   */
  private static async bootstrapSchema(): Promise<void> {
    if (!this.db) return;

    try {
      const tableNames = await this.db.tableNames();
      
      if (!tableNames.includes('ops_logs')) {
        console.log('[RagManager] Bootstrapping [ops_logs] vector table schema...');
        
        // 采用传入初始数据的方式，让 LanceDB 自动推断强类型 Schema。
        // Vector 默认初始化为 1536 维度的 Float32 数组，无缝适配 OpenAI / DeepSeek Embeddings
        await this.db.createTable('ops_logs', [
          {
            id: 'init_sys_record_000',
            vector: new Array(1536).fill(0),
            text_content: 'GETSSH Ai Center Ops Logs successfully initialized.',
            metadata: JSON.stringify({ type: 'system', timestamp: Date.now() })
          }
        ]);
        
        console.log('[RagManager] Schema bootstrap complete. Ops Logs are ready for injection.');
      } else {
        console.log('[RagManager] [ops_logs] table verified in current sandbox.');
      }
    } catch (error) {
      console.error('[RagManager] Failed to bootstrap ops_logs schema:', error);
      throw error;
    }
  }

  /**
   * 获取当前挂载的数据库实例，供后续 IPC 处理器调用
   */
  public static getDB(): lancedb.Connection {
    if (!this.db) {
      throw new Error('[RagManager] Fatal Error: No active LanceDB connection. Sandbox not initialized.');
    }
    return this.db;
  }
}
