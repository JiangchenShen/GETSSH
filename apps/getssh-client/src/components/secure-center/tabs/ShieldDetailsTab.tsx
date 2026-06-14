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
          {t("security.shieldDetailsIntro", "GETSSH 采用自底向上的纵深防御体系，通过六道独立安全屏障，确保您的连接、密钥与数据处于绝对安全的保护之下。")}
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
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsWatchdogDesc", "独立守护程序。若检测到主进程异常挂起，将绕过 V8 引擎直接调用系统底层强制终止被污染的进程，防范劫持。")}</p>
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
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsCryptoDesc", "由 N-API 驱动的 AES-256-GCM 物理加密。结合 PBKDF2 高强度派生密钥，消除 V8 垃圾回收造成的明文残留风险。")}</p>
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
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsZeroizeDesc", "核心凭证运算后，立刻通过 Rust Zeroize 机制在物理内存级别覆写 0x00，并在 TS 层二次擦除，彻底防范内存 Dump 攻击。")}</p>
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
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsNetworkDesc", "SFTP 传输由 Rust N-API 接管 I/O。通过本地零拷贝（Zero-copy）绕过 V8 堆内存，杜绝大文件传输时的 OOM 与 GC 卡顿。")}</p>
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
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsRaspDesc", "内置应用自我保护机制。实时拦截并警报由恶意代码引发的敏感越权行为或高危命令（如 rm -rf 等）。")}</p>
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
            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsMemoryDesc", "利用系统级底层权限实时扫描，检测其他进程针对主进程的动态注入（如 Ptrace）等高危篡改行为。")}</p>
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
