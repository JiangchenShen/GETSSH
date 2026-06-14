import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { Shield, ShieldAlert, Cpu, Lock, EyeOff, Server, Activity } from 'lucide-react';

export const ShieldDetailsTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h4 className="text-3xl font-black tracking-tight mb-4 flex items-center gap-3">
          <Shield className="w-8 h-8 text-green-500 drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]"/> 
          {t("security.shieldDetailsTitle", "六大方位保护您的数据安全")}
        </h4>
        <p className="text-sm opacity-70 leading-relaxed font-medium max-w-3xl">
          {t("security.shieldDetailsIntro", "GETSSH v3.0 采用了全套由底向上的物理级防御体系，确保您的任何核心资产都不会暴露在传统的内存劫持攻击中。")}
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Watchdog */}
        <div className={`relative p-8 flex flex-col gap-5 rounded-2xl shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 border ${isDark ? 'bg-white/5 border-white/10 hover:border-red-500/30' : 'bg-black/5 border-black/10 hover:border-red-500/30'} backdrop-blur-xl group overflow-hidden ${watchdogStatus?.watchdogDisabled ? 'grayscale opacity-50 cursor-not-allowed' : ''}`}>
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-red-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          {watchdogStatus?.watchdogDisabled && (
            <div className="absolute top-4 right-4 px-2 py-1 bg-red-500/20 text-red-500 border border-red-500/30 text-[10px] font-black uppercase tracking-widest shadow-sm rounded-xl">
              Unavailable
            </div>
          )}
          <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-red-500/10 text-red-500 group-hover:scale-110 transition-transform duration-300">
            <Cpu className="w-7 h-7 drop-shadow-md"/>
          </div>
          <div>
            <h5 className="font-bold text-xl mb-2">{t("security.shieldDetailsWatchdog", "The Rust Watchdog")}</h5>
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsWatchdogDesc", "底层的 Rust 二进制看门狗进程。若主进程引擎被恶意代码挂起或停止心跳超过 5 秒，系统将立刻触发底层系统调用 (SIGKILL) 将被污染的内存物理强杀。")}</p>
          </div>
        </div>

        {/* Crypto */}
        <div className={`relative p-8 flex flex-col gap-5 rounded-2xl shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 border ${isDark ? 'bg-white/5 border-white/10 hover:border-green-500/30' : 'bg-black/5 border-black/10 hover:border-green-500/30'} backdrop-blur-xl group overflow-hidden`}>
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-green-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-green-500/10 text-green-500 group-hover:scale-110 transition-transform duration-300">
            <Lock className="w-7 h-7 drop-shadow-md"/>
          </div>
          <div>
            <h5 className="font-bold text-xl mb-2">{t("security.shieldDetailsCrypto", "AES-256-GCM 物理加密")}</h5>
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsCryptoDesc", "您的所有连接凭证与私钥均使用 SafeStorage 与 AES-256-GCM 算法进行极强度的本地加密，密钥不会上传至任何云端。")}</p>
          </div>
        </div>

        {/* Zeroize */}
        <div className={`relative p-8 flex flex-col gap-5 rounded-2xl shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 border ${isDark ? 'bg-white/5 border-white/10 hover:border-blue-500/30' : 'bg-black/5 border-black/10 hover:border-blue-500/30'} backdrop-blur-xl group overflow-hidden`}>
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 group-hover:scale-110 transition-transform duration-300">
            <EyeOff className="w-7 h-7 drop-shadow-md"/>
          </div>
          <div>
            <h5 className="font-bold text-xl mb-2">{t("security.shieldDetailsZeroize", "内存即焚 (Zeroize)")}</h5>
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsZeroizeDesc", "我们在核心凭证流转周期中引入了零化处理（Zeroize），只要变量的生命周期结束，对应内存块会立刻被覆盖为乱码，防止内存 Dump 攻击。")}</p>
          </div>
        </div>

        {/* Zero-copy */}
        <div className={`relative p-8 flex flex-col gap-5 rounded-2xl shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 border ${isDark ? 'bg-white/5 border-white/10 hover:border-purple-500/30' : 'bg-black/5 border-black/10 hover:border-purple-500/30'} backdrop-blur-xl group overflow-hidden`}>
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 group-hover:scale-110 transition-transform duration-300">
            <Server className="w-7 h-7 drop-shadow-md"/>
          </div>
          <div>
            <h5 className="font-bold text-xl mb-2">{t("security.shieldDetailsNetwork", "Zero-copy (零拷贝) 网络引擎")}</h5>
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsNetworkDesc", "使用 Rust N-API 重写网络层，跳过 Node.js 的 V8 引擎直接与系统网卡进行零拷贝的数据交换，物理上隔绝 JavaScript 原生代码注入。")}</p>
          </div>
        </div>

        {/* RASP */}
        <div className={`relative p-8 flex flex-col gap-5 rounded-2xl shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 border ${isDark ? 'bg-white/5 border-white/10 hover:border-orange-500/30' : 'bg-black/5 border-black/10 hover:border-orange-500/30'} backdrop-blur-xl group overflow-hidden`}>
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-orange-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 group-hover:scale-110 transition-transform duration-300">
            <ShieldAlert className="w-7 h-7 drop-shadow-md"/>
          </div>
          <div>
            <h5 className="font-bold text-xl mb-2">{t("security.shieldDetailsRasp", "RASP 运行态主动防御")}</h5>
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsRaspDesc", "集成 RASP (Runtime Application Self-Protection)，所有由插件引发的高危命令（如 rm -rf /、提权操作）在被传递给系统内核前都会被拦截并提示。")}</p>
          </div>
        </div>

        {/* Memory Scan */}
        <div className={`relative p-8 flex flex-col gap-5 rounded-2xl shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 border ${isDark ? 'bg-white/5 border-white/10 hover:border-cyan-500/30' : 'bg-black/5 border-black/10 hover:border-cyan-500/30'} backdrop-blur-xl group overflow-hidden`}>
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          <div className="shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500 group-hover:scale-110 transition-transform duration-300">
            <Activity className="w-7 h-7 drop-shadow-md"/>
          </div>
          <div className="flex-1">
            <h5 className="font-bold text-xl mb-2">{t("security.shieldDetailsMemory", "内存态全量扫描 (macOS Only)")}</h5>
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsMemoryDesc", "对于 macOS，如果授予 GETSSH sudo 权限，它将在底层调用 `vmmap` 扫描其它进程试图对当前主进程进行的 Ptrace/注入攻击。")}</p>
          </div>
          <div className="mt-auto pt-4 flex justify-end">
            <button 
              className="px-5 py-2.5 bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-500 border border-cyan-500/30 text-xs font-bold transition-all flex items-center gap-2 rounded-xl"
              onClick={() => window.alert(t("security.memoryScannerRootHint", "提示：在 macOS 系统中，底层内存完整性校验需要内核级权限。请在终端中使用 `sudo` 运行此应用程序的二进制文件来激活它。") as string)}
            >
              <Lock className="w-3.5 h-3.5" />
              {t("security.btnEnableMemoryScanner", "启用内存扫描 (需 Root)")}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
