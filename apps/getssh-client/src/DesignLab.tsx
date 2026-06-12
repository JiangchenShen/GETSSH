import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import { Terminal, HardDrive, Cpu, ArrowRight } from 'lucide-react';
import './index.css';

const MOCK_ITEMS = [
  { id: '1', title: 'prod-db-master', subtitle: 'root@192.168.1.10', icon: HardDrive, color: 'text-emerald-400' },
  { id: '2', title: 'staging-k8s-node', subtitle: 'ubuntu@192.168.1.20', icon: Terminal, color: 'text-primary' },
  { id: '3', title: 'System Monitor Plugin', subtitle: 'Local Extension', icon: Cpu, color: 'text-blue-400' },
  { id: '4', title: 'ci-runner-01', subtitle: 'gitlab@10.0.0.5', icon: Terminal, color: 'text-primary' },
];

const DesignLab = () => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, MOCK_ITEMS.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className="w-screen h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        // A vivid, cyberpunk-style gradient background to test the water-glass effect
        background: 'radial-gradient(circle at top right, #3b0764, transparent), radial-gradient(circle at bottom left, #083344, transparent), #000',
        backgroundSize: '100% 100%'
      }}
    >
      {/* Decorative floating blur orbs */}
      <div className="absolute top-[20%] left-[30%] w-96 h-96 bg-purple-600/30 rounded-full blur-[100px]" />
      <div className="absolute bottom-[20%] right-[30%] w-96 h-96 bg-cyan-600/30 rounded-full blur-[100px]" />

      <motion.div
        initial={{ y: 80, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 350, damping: 40, mass: 0.8 }}
        className="water-glass rounded-2xl w-[600px] flex flex-col overflow-hidden text-white border border-white/10 z-10"
      >
        <div className="p-5 border-b border-white/10">
          <input
            type="text"
            placeholder="Type to search prototypes..."
            className="w-full bg-transparent text-2xl font-semibold outline-none ring-0 placeholder-white/30 text-white"
            autoFocus
          />
        </div>

        <div className="p-3 flex flex-col gap-1">
          {MOCK_ITEMS.map((item, index) => {
            const isActive = index === activeIndex;
            const Icon = item.icon;

            return (
              <div
                key={item.id}
                onMouseEnter={() => setActiveIndex(index)}
                className="relative flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer group"
              >
                {/* Smooth PPT-like highlight morphing via layoutId */}
                {isActive && (
                  <motion.div
                    layoutId="active-bg"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    /* 
                      【物理手感盲测预设】
                      请取消注释以切换对应的弹簧手感：
                    */

                    // 预设 A：Raycast 极速磁吸流（极度干脆，无延迟感）
                    // transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.5 }}

                    // 预设 B：德芙重水银流（极致粘滞，高阻尼感）
                    // transition={{ type: 'spring', stiffness: 250, damping: 35, mass: 1.2 }}

                    // 预设 C：苹果级流体悬浮（Apple Fluid，完美的平衡）
                    transition={{ type: 'spring', stiffness: 350, damping: 30, mass: 1 }}
                    className="absolute inset-0 bg-white/10 rounded-lg pointer-events-none"
                  />
                )}

                {/* Content (ensure z-index to appear above the absolute background) */}
                <div className="relative z-10 flex items-center justify-between w-full">
                  <div className="flex items-center gap-4">
                    <Icon className={`w-6 h-6 ${item.color} ${isActive ? 'scale-110' : ''} transition-transform duration-200`} />
                    <div className="flex flex-col">
                      <span className="font-medium text-lg text-white/90">{item.title}</span>
                      <span className="text-sm text-white/50">{item.subtitle}</span>
                    </div>
                  </div>
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-white/80"
                    >
                      <ArrowRight className="w-5 h-5" />
                    </motion.div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<DesignLab />);
}
