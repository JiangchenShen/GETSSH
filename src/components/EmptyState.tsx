import React from 'react';
import { CommandCenter } from './CommandCenter';

interface EmptyStateProps {
  onConnect?: (session: any) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onConnect }) => {
  return (
    <CommandCenter 
      onConnect={(session) => {
        if (onConnect) onConnect(session);
      }} 
    />
  );
};
