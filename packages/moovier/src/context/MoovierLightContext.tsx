import React, { createContext, useContext, useEffect, useState, useRef } from 'react';

interface LightPosition {
  x: number;
  y: number;
}

interface MoovierLightContextProps {
  lightPosition: LightPosition | null; // null means mouse is inactive, fallback to top-left
}

const MoovierLightContext = createContext<MoovierLightContextProps>({ lightPosition: null });

export const MoovierLightProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lightPosition, setLightPosition] = useState<LightPosition | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<any>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setLightPosition({ x: e.clientX, y: e.clientY });
      });

      // If mouse stops moving for 2 seconds, fade back to static top-left light
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setLightPosition(null);
      }, 2000);
    };

    const handleMouseLeave = () => {
      setLightPosition(null);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <MoovierLightContext.Provider value={{ lightPosition }}>
      {children}
    </MoovierLightContext.Provider>
  );
};

export const useMoovierLight = () => useContext(MoovierLightContext);
