import React, { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SFTPFile {
  name: string;
  longname: string;
  type: 'd' | '-' | 'l';
  size: number;
  mtime: number;
}

export const SFTPManager = ({ sessionId, isDark }: { sessionId: string, isDark: boolean }) => {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<SFTPFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.sftpList(sessionId, path);
      if (res.success) {
        setFiles(res.list.sort((a: SFTPFile, b: SFTPFile) => {
           if (a.type === 'd' && b.type !== 'd') return -1;
           if (a.type !== 'd' && b.type === 'd') return 1;
           return a.name.localeCompare(b.name);
        }));
        setCurrentPath(path);
      } else {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles('/');
  }, [sessionId]);

  const handleNavigate = (folder: string) => {
    if (folder === '..') {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      fetchFiles('/' + parts.join('/'));
    } else {
      const newPath = currentPath === '/' ? `/${folder}` : `${currentPath}/${folder}`;
      fetchFiles(newPath);
    }
  };

  const handleDelete = async (e: React.MouseEvent, file: SFTPFile) => {
    e.stopPropagation();
    if (!window.confirm(t('sftp.deleteConfirm', { name: file.name }))) return;
    const path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const res = await window.electronAPI.sftpDelete(sessionId, path, file.type === 'd');
    if (res.success) {
      fetchFiles(currentPath);
    } else {
      alert(t('sftp.deleteFailed') + res.error);
    }
  };

  const handleDoubleClick = async (file: SFTPFile) => {
    if (file.type === 'd') {
      handleNavigate(file.name);
      return;
    }
    
    try {
      const path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      const res = await window.electronAPI.sftpEditSync(sessionId, path);
      if (res.success) {
        // Optional: add UI indication or just let it be silent
      }
    } catch (error) {
      console.error('Failed to start SFTP sync edit:', error);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={`flex flex-col h-full border-l shadow-2xl ${isDark ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-gray-50 border-black/10 text-black'}`}>
      <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <h2 className="font-bold flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-primary" />
          {t('sftp.title')}
        </h2>
        <div className="flex gap-2">
          <button onClick={() => fetchFiles(currentPath)} className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>
      
      <div className={`px-4 py-2 text-xs flex items-center gap-1 font-mono opacity-80 overflow-x-auto whitespace-nowrap border-b-[1.5px] border-t-0 border-l-0 border-r-0 ${isDark ? 'bg-black/20 text-white/50 border-white/10' : 'bg-black/5 text-black/50 border-black/10'}`}>
        <button onClick={() => fetchFiles('/')} className="hover:text-primary transition-colors cursor-pointer">{t('sftp.root')}</button>
        {currentPath.split('/').filter(Boolean).map((part, idx, arr) => (
           <React.Fragment key={idx}>
             <ChevronRight className="w-3 h-3 opacity-50" />
             <button onClick={() => fetchFiles('/' + arr.slice(0, idx + 1).join('/'))} className="hover:text-primary transition-colors cursor-pointer">{part}</button>
           </React.Fragment>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-0">
        {error ? (
           <div className="p-4 text-red-500 text-sm">{error}</div>
        ) : (
           <table className="w-full text-sm text-left">
             <thead className={`text-xs uppercase sticky top-0 z-20 shadow-sm border-b-[1.5px] border-t-0 border-l-0 border-r-0 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
               <tr>
                 <th className={`px-2 py-2 font-medium sticky top-0 ${isDark ? 'bg-[#1e1e1e]' : 'bg-gray-50'}`}>{t('sftp.name')}</th>
                 <th className={`px-2 py-2 font-medium w-24 sticky top-0 ${isDark ? 'bg-[#1e1e1e]' : 'bg-gray-50'}`}>{t('sftp.size')}</th>
                 <th className={`px-2 py-2 font-medium w-32 sticky top-0 ${isDark ? 'bg-[#1e1e1e]' : 'bg-gray-50'}`}>{t('sftp.modified')}</th>
                 <th className={`px-2 py-2 font-medium w-10 sticky top-0 ${isDark ? 'bg-[#1e1e1e]' : 'bg-gray-50'}`}></th>
               </tr>
             </thead>
             <tbody>
               {currentPath !== '/' && (
                 <tr onClick={() => handleNavigate('..')} className={`cursor-pointer transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                   <td className="px-2 py-2 flex items-center gap-2"><Folder className="w-4 h-4 text-blue-400" /> ..</td>
                   <td></td><td></td><td></td>
                 </tr>
               )}
               {files.map(f => (
                 <tr key={f.name} onDoubleClick={() => handleDoubleClick(f)} onClick={() => f.type === 'd' && handleNavigate(f.name)} className={`group transition-colors ${f.type === 'd' ? 'cursor-pointer' : 'cursor-pointer'} ${isDark ? 'hover:bg-white/5 border-white/5' : 'hover:bg-black/5 border-black/5'} border-b last:border-0`}>
                   <td className="px-2 py-2 flex items-center gap-2 truncate max-w-[200px]" title={f.name}>
                     {f.type === 'd' ? <Folder className="w-4 h-4 text-blue-400 shrink-0" /> : <File className="w-4 h-4 opacity-70 shrink-0" />}
                     <span className="truncate">{f.name}</span>
                   </td>
                   <td className="px-2 py-2 opacity-70 font-mono text-xs">{f.type === 'd' ? '--' : formatSize(f.size)}</td>
                   <td className="px-2 py-2 opacity-50 text-xs">{new Date(f.mtime * 1000).toLocaleDateString()}</td>
                   <td className="px-2 py-2">
                     <button onClick={(e) => handleDelete(e, f)} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 hover:bg-red-500/20 rounded transition-all">
                       <Trash2 className="w-3.5 h-3.5" />
                     </button>
                   </td>
                 </tr>
               ))}
             </tbody>
           </table>
        )}
      </div>
    </div>
  );
};
