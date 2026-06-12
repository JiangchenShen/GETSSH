import React, { useEffect, useState } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { SPRING_FLUID, SPRING_SNAPPY, SPRING_GENTLE, CINEMATIC_OUT } from '../utils/physics';
import { useMoovierFocus } from '../context/MoovierFocusContext';

export interface MoovierTileProps extends HTMLMotionProps<"div"> {
  children?: React.ReactNode;
  className?: string;
  /**
   * 拖拽能力等级：
   * - global: 支持越界撕裂，全域自由拖拽
   * - local: 仅容器内拖拽，触边产生极强回弹
   * - fixed: 不可拖拽
   */
  dragLevel?: 'global' | 'local' | 'fixed';
  /**
   * 用于景深调度的唯一 ID，如果为空则不参与降压调度
   */
  tileId?: string;
  /**
   * 是否豁免于景深降压（如侧边栏、控制中心）
   */
  exemptFromFocus?: boolean;
}

/**
 * <MoovierTile> - The Atomic Building Block of MOOVIER SUPREME
 * 
 * 核心特性：
 * 1. 建筑棱角：默认 border-radius 为 0（控制中心外部强制要求）。
 * 2. 物理光影：三层复合阴影 + 左上 45° 轮廓光折射。
 * 3. 电影级互动：绑定 Hover、Tap 及完整的 Drag 滑行与惯性反馈。
 * 4. 景深调度：原生支持 Cinematic Focus Pulling（镜头级对焦变暗/失焦特效）。
 */
export const MoovierTile: React.FC<MoovierTileProps> = ({ 
  children, 
  className = '', 
  dragLevel = 'fixed',
  tileId,
  exemptFromFocus = false,
  style,
  onPointerDown,
  ...props 
}) => {
  const isDraggable = dragLevel !== 'fixed';
  const { activeTileId, setActiveTileId } = useMoovierFocus();

  // --- 景深调度状态 ---
  const isFocused = activeTileId === tileId;
  const isBlurTarget = activeTileId !== null && !isFocused && tileId && !exemptFromFocus;

  // 150ms 脉冲动画状态 (对焦咔哒感)
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if (isFocused && activeTileId !== null) {
      // 获取焦点 150ms 后触发短促脉冲
      const timer1 = setTimeout(() => setIsPulsing(true), 150);
      const timer2 = setTimeout(() => setIsPulsing(false), 250);
      return () => { clearTimeout(timer1); clearTimeout(timer2); };
    }
  }, [isFocused, activeTileId]);

  return (
    <motion.div
      {...props}
      onPointerDown={(e) => {
        if (tileId) setActiveTileId(tileId);
        if (onPointerDown) onPointerDown(e);
      }}
      className={`
        relative overflow-hidden
        rounded-none /* 严格遵守第 1 章的建筑棱角审美，0px 圆角 */
        backdrop-blur-xl /* 基础的 Liquid Glass 质感注入 */
        ${className}
      `}
      style={{
        // 挂载默认静态光影与零延迟透明度变量
        backgroundColor: `rgba(0, 0, 0, var(--glass-transparency, 0.2))`,
        ...style,
      }}
      
      // --- 镜头级景深调度与物理光影 ---
      initial={false}
      animate={{
        // 非焦点状态降压：亮度 0.6，饱和度 0.5，增加 0.6px 散焦模糊
        filter: isBlurTarget 
          ? "brightness(0.6) saturate(0.5) blur(0.6px)" 
          : "brightness(1) saturate(1) blur(0px)",
        // 透明度退隐
        opacity: isBlurTarget ? 0.8 : 1,
        // Z轴微缩，产生后退感
        scale: isBlurTarget ? 0.992 : 1,
        // 光效调度：如果在脉冲期，调用强轮廓光
        boxShadow: isPulsing 
          ? "var(--shadow-moovier-composite), var(--shadow-moovier-rim-hover)" 
          : "var(--shadow-moovier-composite), var(--shadow-moovier-rim-default)"
      }}
      transition={{
        filter: { duration: 0.3, ease: CINEMATIC_OUT },
        opacity: { duration: 0.3, ease: CINEMATIC_OUT },
        boxShadow: isPulsing ? { duration: 0.05 } : { duration: 0.3, ease: CINEMATIC_OUT },
        scale: SPRING_GENTLE
      }}

      // --- 物理级交互动效 (Hover & Tap) ---
      whileHover={{
        y: -2,
        boxShadow: "var(--shadow-moovier-composite), var(--shadow-moovier-rim-hover)",
        transition: SPRING_FLUID
      }}
      whileTap={{
        scale: 0.98,
        transition: SPRING_SNAPPY
      }}

      // --- 物理级拖拽系统 (Drag & Momentum) ---
      drag={isDraggable}
      dragElastic={dragLevel === 'local' ? 0.05 : 0.2}
      dragMomentum={true}
      dragTransition={{ 
        bounceStiffness: SPRING_FLUID.stiffness, 
        bounceDamping: SPRING_FLUID.damping,
        timeConstant: 400 
      }}
      whileDrag={{
        scale: 1.02,
        y: -4,
        boxShadow: "var(--shadow-moovier-composite), var(--shadow-moovier-rim-drag)",
        cursor: "grabbing",
      }}
    >
      {children}
    </motion.div>
  );
};
