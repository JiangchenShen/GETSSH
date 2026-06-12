import React, { useEffect, useState, useRef } from 'react';
import { MoovierTile } from './components/MoovierTile';
import { MoovierFocusProvider } from './context/MoovierFocusContext';

/**
 * 极限应力测试背景 (Stress Background)
 * 极具挑战性的极光渐变 + 高频网格纹理，用于测试 P0 级文字可读性和玻璃材质折射能力。
 */
const StressBackground = () => (
  <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
    {/* Aurora Gradient */}
    <div className="absolute inset-0 bg-gradient-to-br from-[#ff0055] via-[#4a00e0] to-[#00f2fe] opacity-80" />
    {/* Complex Grid Texture */}
    <div className="absolute inset-0 opacity-20" style={{
      backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
      backgroundSize: '24px 24px'
    }} />
    {/* Floating Orbs (High luminance spots to test inner glow and rim light visibility) */}
    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-screen filter blur-[100px] opacity-70 animate-pulse" />
    <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-500 rounded-full mix-blend-screen filter blur-[120px] opacity-60" />
  </div>
);

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transparency, setTransparency] = useState(0.20);

  // 零延迟 WYSIWYG：绕过 React 渲染周期直接修改根节点的 CSS 变量
  const handleTransparencyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setTransparency(val);
    document.documentElement.style.setProperty('--glass-transparency', val.toString());
  };

  useEffect(() => {
    // 挂载初始变量
    document.documentElement.style.setProperty('--glass-transparency', transparency.toString());
  }, []);

  return (
    <MoovierFocusProvider>
      <div ref={containerRef} className="min-h-screen w-full font-sans text-white relative overflow-hidden">
        <StressBackground />

        {/* 独立磁贴：控制中心零延迟透明度滑块 */}
        <MoovierTile 
          dragLevel="local" 
          exemptFromFocus
          dragConstraints={containerRef}
          className="absolute top-8 left-8 p-6 flex flex-col gap-4 w-80 z-50"
          style={{ borderRadius: '16px', backgroundColor: 'rgba(0,0,0,0.6)' }} // 模拟控制中心黑玻璃材质
        >
          <h2 className="text-sm font-semibold tracking-wider text-white/70 uppercase">Global Transparency</h2>
          <input 
            type="range" 
            min="0" 
            max="0.8" 
            step="0.01" 
            value={transparency} 
            onChange={handleTransparencyChange}
            className="w-full cursor-pointer accent-white"
          />
          <div className="text-xs font-mono text-white/50 text-right">
            --glass-transparency: {transparency.toFixed(2)}
          </div>
        </MoovierTile>

        {/* 侧边栏磁贴 (模拟免于失焦的左侧导航) */}
        <MoovierTile 
          tileId="sidebar"
          exemptFromFocus
          dragLevel="global" 
          dragConstraints={containerRef}
          className="absolute top-40 left-8 w-64 h-[600px] p-8 flex flex-col z-10"
        >
          <h2 className="text-xl font-bold tracking-wider mb-6 text-white/90">Workspaces</h2>
          <div className="flex-1 space-y-4">
            <div className="h-10 bg-white/10 rounded-sm"></div>
            <div className="h-10 bg-white/10 rounded-sm"></div>
            <div className="h-10 bg-white/5 rounded-sm"></div>
          </div>
        </MoovierTile>

        {/* 终端 1 (主控室) */}
        <MoovierTile 
          tileId="term-1"
          dragLevel="global" 
          dragConstraints={containerRef}
          className="absolute top-40 left-80 w-[600px] h-[400px] p-12 flex flex-col z-20 cursor-default"
        >
          <h1 className="text-4xl font-bold tracking-tight mb-4 text-white drop-shadow-md">
            Terminal Alpha
          </h1>
          <p className="text-sm text-white/70 font-mono">root@moovier-supreme:~#</p>
          <p className="mt-4 text-white/90 font-light">
            Click me to acquire Focus. Notice the 150ms rim light pulse when focused.
            Other terminal tiles will seamlessly fade into darkness.
          </p>
        </MoovierTile>

        {/* 终端 2 (副监控屏) */}
        <MoovierTile 
          tileId="term-2"
          dragLevel="global" 
          dragConstraints={containerRef}
          className="absolute top-16 right-16 w-[400px] h-[300px] p-8 flex flex-col z-10 cursor-default"
        >
          <h1 className="text-2xl font-bold tracking-tight mb-4 text-white drop-shadow-md">
            Syslog Monitor
          </h1>
          <p className="text-sm text-white/70 font-mono">tail -f /var/log/system.log</p>
          <p className="mt-4 text-white/90 font-light">
            If you click me, Terminal Alpha will dim. 
            The sidebar will remain bright because it is exempt from focus.
          </p>
        </MoovierTile>

        {/* 终端 3 (迷你卡片) */}
        <MoovierTile 
          tileId="term-3"
          dragLevel="global" 
          dragConstraints={containerRef}
          className="absolute bottom-16 right-16 w-[300px] h-[200px] p-6 flex flex-col z-10 cursor-default"
        >
          <h1 className="text-lg font-bold text-white drop-shadow-md">
            Mini Dashboard
          </h1>
          <p className="mt-2 text-sm text-white/80 font-light">
            I will also be affected by Cinematic Focus Pulling.
          </p>
        </MoovierTile>
      </div>
    </MoovierFocusProvider>
  );
}
