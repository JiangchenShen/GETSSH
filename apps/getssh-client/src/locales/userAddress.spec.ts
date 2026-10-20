import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import zhCN from './zh-CN.json';

vi.mock('../store/appStore', () => ({ useAppStore: vi.fn() }));
import { PERSONAS } from '../utils/persona';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

describe('Chinese forms of address', () => {
  it('uses the respectful form throughout product copy, except AI prompt presets and their placeholder', () => {
    const hits: string[] = [];
    function scan(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { scan(path); continue; }
        if (!/\.(?:tsx?|json)$/.test(entry.name) || /\.(?:spec|test|d)\.[^.]+$/.test(entry.name)) continue;
        const name = relative(sourceRoot, path);
        if (name === 'utils/persona.ts') continue;
        let text = readFileSync(path, 'utf8');
        if (name === 'locales/zh-CN.json') {
          const locale = JSON.parse(text);
          delete locale.translation.aiSettings.personaSystemPromptPlaceholder;
          text = JSON.stringify(locale, null, 2);
        }
        text.split('\n').forEach((line, index) => {
          if (!/^\s*(?:\/\/|\/\*|\*|\{\/\*)/.test(line) && line.includes('你')) hits.push(`${name}:${index + 1} ${line.trim()}`);
        });
      }
    }
    scan(sourceRoot);
    expect(hits).toEqual([]);
  });

  it('preserves the original AI instructions addressed to the model', () => {
    expect(Object.values(PERSONAS).map(persona => persona.zh)).toEqual([
      '你是一个 Linux 专家。请专注于操作系统底层细节、内核、网络协议栈以及文件系统。提供健壮的 bash 脚本，并避免使用 GUI 工具。',
      '你是一个日志分析专家。你的主要任务是解析和提取原始服务器日志中的关键信息。对时间戳、堆栈跟踪和异常检测要极其精确。',
      '你是一个 Docker 大师。请始终优先考虑容器化解决方案。提供简洁的 Dockerfile、优化镜像构建，以及安全的 docker-compose 配置。',
      '你是一个安全审计专家。请评估每一个命令和脚本中潜在的漏洞、权限提升风险以及最佳实践。强制执行最小权限原则。',
    ]);
    expect(zhCN.translation.aiSettings.personaSystemPromptPlaceholder).toBe('你是一名资深的数据库架构师...');
  });
});
