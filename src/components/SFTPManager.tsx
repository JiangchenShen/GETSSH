import React, { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, HardDrive, RefreshCw, Trash2, FilePlus, FolderPlus } from 'lucide-react';
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
  const [promptData, setPromptData] = useState<{ type: 'file' | 'folder', resolve: (name: string | null) => void } | null>(null);
  const [promptInputValue, setPromptInputValue] = useState('');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInputValue, setPathInputValue] = useState('');

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
    // If it's a symlink, we could try to edit it as a file first. If it's actually a directory, sftpEditSync might fail, but let's keep it simple.
    
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

  const handleAddFile = async () => {
    const name = await new Promise<string | null>((resolve) => {
      setPromptInputValue('');
      setPromptData({ type: 'file', resolve });
    });
    if (!name) return;
    const path = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    const res = await window.electronAPI.sftpWriteFile(sessionId, path, '');
    if (res.success) {
      fetchFiles(currentPath);
    } else {
      setError('Failed to create file: ' + res.error);
    }
  };

  const handleAddFolder = async () => {
    const name = await new Promise<string | null>((resolve) => {
      setPromptInputValue('');
      setPromptData({ type: 'folder', resolve });
    });
    if (!name) return;
    const path = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    const res = await window.electronAPI.sftpMkdir(sessionId, path);
    if (res.success) {
      fetchFiles(currentPath);
    } else {
      setError('Failed to create folder: ' + res.error);
    }
  };

  return (
    <div className={`flex flex-col h-full border-l shadow-2xl relative ${isDark ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-gray-50 border-black/10 text-black'}`}>
      <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <h2 className="font-bold flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-primary" />
          {t('sftp.title')}
        </h2>
        <div className="flex gap-1">
          <button onClick={handleAddFile} className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`} title="New File"><FilePlus className="w-4 h-4 opacity-80" /></button>
          <button onClick={handleAddFolder} className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`} title="New Folder"><FolderPlus className="w-4 h-4 opacity-80" /></button>
          <button onClick={() => fetchFiles(currentPath)} className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'}`} title="Refresh"><RefreshCw className={`w-4 h-4 opacity-80 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>
      
      <div 
        className={`px-4 py-2 text-xs flex items-center gap-1 font-mono opacity-80 overflow-x-auto whitespace-nowrap border-b-[1.5px] border-t-0 border-l-0 border-r-0 cursor-text transition-colors min-h-[32px] ${isDark ? 'bg-black/20 text-white/50 border-white/10 hover:bg-black/40' : 'bg-black/5 text-black/50 border-black/10 hover:bg-black/10'}`}
        onClick={() => {
          if (!isEditingPath) {
            setPathInputValue(currentPath);
            setIsEditingPath(true);
          }
        }}
        title="Click to edit path"
      >
        {isEditingPath ? (
          <input 
            autoFocus
            value={pathInputValue}
            onChange={e => setPathInputValue(e.target.value)}
            onBlur={() => setIsEditingPath(false)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const targetPath = pathInputValue.trim() || '/';
                fetchFiles(targetPath);
                setIsEditingPath(false);
              } else if (e.key === 'Escape') {
                setIsEditingPath(false);
              }
            }}
            className="w-full bg-transparent outline-none border-none text-primary"
          />
        ) : (
          <>
            <button onClick={(e) => { e.stopPropagation(); fetchFiles('/'); }} className="hover:text-primary transition-colors cursor-pointer">{t('sftp.root')}</button>
            {currentPath.split('/').filter(Boolean).map((part, idx, arr) => (
               <React.Fragment key={idx}>
                 <ChevronRight className="w-3 h-3 opacity-50" />
                 <button onClick={(e) => { e.stopPropagation(); fetchFiles('/' + arr.slice(0, idx + 1).join('/')); }} className="hover:text-primary transition-colors cursor-pointer">{part}</button>
               </React.Fragment>
            ))}
          </>
        )}
      </div>

      {promptData && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className={`p-4 rounded-xl shadow-2xl w-3/4 max-w-sm ${isDark ? 'bg-[#2a2a2a] text-white border border-white/10' : 'bg-white text-black border border-black/10'}`}>
             <h3 className="text-sm font-bold mb-3">{promptData.type === 'file' ? 'New File' : 'New Folder'}</h3>
             <input
               autoFocus
               value={promptInputValue}
               onChange={e => setPromptInputValue(e.target.value)}
               onKeyDown={e => {
                 if (e.key === 'Enter') {
                   promptData.resolve(promptInputValue);
                   setPromptData(null);
                 } else if (e.key === 'Escape') {
                   promptData.resolve(null);
                   setPromptData(null);
                 }
               }}
               className={`w-full p-2 text-sm rounded-md outline-none border ${isDark ? 'bg-black/50 border-white/10' : 'bg-gray-100 border-black/10'}`}
               placeholder={`Enter ${promptData.type} name...`}
             />
             <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { promptData.resolve(null); setPromptData(null); }} className={`px-3 py-1.5 text-xs rounded-md transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}>Cancel</button>
                <button onClick={() => { promptData.resolve(promptInputValue); setPromptData(null); }} className="px-3 py-1.5 text-xs rounded-md bg-primary hover:bg-primary/80 transition-colors text-white">Create</button>
             </div>
          </div>
        </div>
      )}

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
                 <tr key={f.name} onDoubleClick={() => handleDoubleClick(f)} onClick={() => (f.type === 'd' || f.type === 'l') && handleNavigate(f.name)} className={`group transition-colors ${f.type === 'd' || f.type === 'l' ? 'cursor-pointer' : 'cursor-pointer'} ${isDark ? 'hover:bg-white/5 border-white/5' : 'hover:bg-black/5 border-black/5'} border-b last:border-0`}>
                   <td className="px-2 py-2 flex items-center gap-2 truncate max-w-[200px]" title={f.name}>
                     {f.type === 'd' ? <Folder className="w-4 h-4 text-blue-400 shrink-0" /> : <File className={`w-4 h-4 shrink-0 ${f.type === 'l' ? 'text-blue-200' : 'opacity-70'}`} />}
                     <span className="truncate">{f.name}{f.type === 'l' && ' 🔗'}</span>
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
