import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Link, Server, FileCode2, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';

export const AssetBridgeTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string>('');
  const [loadingAssets, setLoadingAssets] = useState(false);
  
  const [profiles, setProfiles] = useState<any[]>([]);
  const [runbooks, setRunbooks] = useState<any[]>([]);
  
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [selectedRunbooks, setSelectedRunbooks] = useState<Set<string>>(new Set());
  
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [error, setError] = useState('');

  // Filter out the active workspace from the dropdown
  const otherWorkspaces = workspaces.filter(w => (typeof w === 'string' ? w : w.id) !== activeWorkspaceId);

  useEffect(() => {
    if (!sourceWorkspaceId) {
      setProfiles([]);
      setRunbooks([]);
      return;
    }
    
    let isMounted = true;
    const fetchAssets = async () => {
      setLoadingAssets(true);
      setError('');
      try {
        const res = await window.electronAPI.bridgeFetchProfiles(sourceWorkspaceId);
        if (isMounted) {
          if (res.success) {
            setProfiles(res.profiles || []);
            setRunbooks(res.runbooks || []);
          } else {
            setError(res.error || 'Failed to fetch assets. Vault might be locked.');
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoadingAssets(false);
      }
    };
    
    fetchAssets();
    
    return () => { isMounted = false; };
  }, [sourceWorkspaceId]);

  const toggleProfile = (id: string) => {
    const newSet = new Set(selectedProfiles);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedProfiles(newSet);
  };

  const toggleRunbook = (id: string) => {
    const newSet = new Set(selectedRunbooks);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedRunbooks(newSet);
  };

  const handleImport = async () => {
    if (selectedProfiles.size === 0 && selectedRunbooks.size === 0) return;
    
    setImporting(true);
    setError('');
    setImportSuccess(false);
    
    const profilesToImport = profiles.filter(p => selectedProfiles.has(p.id));
    const runbooksToImport = runbooks.filter(r => selectedRunbooks.has(r.id));
    
    try {
      const res = await window.electronAPI.bridgeImportProfiles(activeWorkspaceId, profilesToImport, runbooksToImport);
      if (res.success) {
        setImportSuccess(true);
        setSelectedProfiles(new Set());
        setSelectedRunbooks(new Set());
        // Reload profiles in the session store so they show up immediately
        useWorkspaceStore.getState().switchWorkspace(activeWorkspaceId); // Re-trigger load
      } else {
        setError(res.error || 'Failed to import assets.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto mt-4">
      <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white">
        <Link className="w-10 h-10 text-blue-500"/> {t("workspaceCenter.sidebar.assetBridge", "Asset Bridge")}
      </h4>
      
      <div className={`relative overflow-hidden p-8 border flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl ${isDark ? 'bg-black/40 border-blue-500/20' : 'bg-white/40 border-blue-500/20'}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative z-10 space-y-6">
          <p className="text-sm font-bold opacity-80 leading-relaxed">
            {t('workspaceCenter.assetBridgeDesc', 'Securely import connection profiles and runbooks from another isolated workspace without exposing your vault.')}
          </p>

          {error && (
             <div className="text-red-500 text-xs font-bold uppercase tracking-widest bg-red-500/10 p-4 leading-relaxed rounded-xl shadow-sm border border-red-500/20">
               {error}
             </div>
          )}

          {importSuccess && (
             <div className="text-emerald-500 flex items-center gap-3 text-xs font-bold uppercase tracking-widest bg-emerald-500/10 p-4 leading-relaxed rounded-xl shadow-sm border border-emerald-500/20">
               <CheckCircle2 className="w-5 h-5"/> {t('workspaceCenter.importSuccess', 'Assets imported successfully!')}
             </div>
          )}

          {/* Source Workspace Selector */}
          <div>
            <label className="block text-xs font-bold mb-3 uppercase tracking-widest opacity-60">
              {t('workspaceCenter.selectSourceWorkspace', 'Source Workspace')}
            </label>
            <select
              value={sourceWorkspaceId}
              onChange={(e) => setSourceWorkspaceId(e.target.value)}
              className={`w-full p-4 border text-sm font-bold tracking-widest outline-none transition-all rounded-xl focus:border-blue-500/50 shadow-inner appearance-none ${isDark ? 'bg-black/50 border-white/10 text-blue-400 focus:bg-black/80' : 'bg-white border-black/10 text-blue-600'}`}
            >
              <option value="">-- {t('workspaceCenter.chooseWorkspace', 'Choose a workspace')} --</option>
              {otherWorkspaces.map(w => {
                const id = typeof w === 'string' ? w : w.id;
                const name = typeof w === 'string' ? (id === 'default' ? 'Default Workspace' : id) : w.name;
                return <option key={id} value={id}>{name}</option>;
              })}
            </select>
          </div>

          {/* Assets Selection Area */}
          {sourceWorkspaceId && (
            <div className={`p-6 rounded-2xl border ${isDark ? 'bg-black/30 border-white/5' : 'bg-black/5 border-black/5'}`}>
              {loadingAssets ? (
                <div className="flex flex-col items-center justify-center py-10 opacity-50">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                  <span className="text-xs font-bold uppercase tracking-widest">{t('workspaceCenter.loadingAssets', 'Loading Assets...')}</span>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Profiles List */}
                  <div>
                    <h5 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest mb-4 opacity-70">
                      <Server className="w-4 h-4"/> {t('workspaceCenter.serverProfiles', 'Server Profiles')} ({profiles.length})
                    </h5>
                    {profiles.length === 0 ? (
                      <p className="text-xs opacity-40 font-bold italic">{t('workspaceCenter.noProfilesFound', 'No profiles found in source workspace.')}</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {profiles.map(p => (
                          <div 
                            key={p.id}
                            onClick={() => toggleProfile(p.id)}
                            className={`p-3 border rounded-xl cursor-pointer transition-all flex items-center justify-between group ${selectedProfiles.has(p.id) ? 'bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : (isDark ? 'bg-white/5 border-white/5 hover:border-white/20' : 'bg-white border-black/5 hover:border-black/20')}`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className={`w-3 h-3 rounded-full border ${selectedProfiles.has(p.id) ? 'bg-blue-500 border-blue-500' : 'border-current opacity-30 group-hover:opacity-60'}`} />
                              <div className="truncate">
                                <div className="font-bold text-sm truncate">{p.alias || p.host}</div>
                                <div className="text-[10px] opacity-50 truncate font-mono">{p.username}@{p.host}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Runbooks List */}
                  <div>
                    <h5 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest mb-4 opacity-70">
                      <FileCode2 className="w-4 h-4"/> {t('workspaceCenter.runbooksTitle', 'Runbooks')} ({runbooks.length})
                    </h5>
                    {runbooks.length === 0 ? (
                      <p className="text-xs opacity-40 font-bold italic">{t('workspaceCenter.noRunbooksFound', 'No runbooks found in source workspace.')}</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {runbooks.map(r => (
                          <div 
                            key={r.id}
                            onClick={() => toggleRunbook(r.id)}
                            className={`p-3 border rounded-xl cursor-pointer transition-all flex items-center justify-between group ${selectedRunbooks.has(r.id) ? 'bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : (isDark ? 'bg-white/5 border-white/5 hover:border-white/20' : 'bg-white border-black/5 hover:border-black/20')}`}
                          >
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className={`w-3 h-3 rounded-full border ${selectedRunbooks.has(r.id) ? 'bg-blue-500 border-blue-500' : 'border-current opacity-30 group-hover:opacity-60'}`} />
                              <div className="truncate">
                                <div className="font-bold text-sm truncate">{r.title}</div>
                                <div className="text-[10px] opacity-50 truncate uppercase">{r.riskLevel || 'LOW'}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          )}

          {/* Action Footer */}
          <div className="flex justify-end pt-6 mt-6 border-t border-current/10">
            <button 
              disabled={importing || (selectedProfiles.size === 0 && selectedRunbooks.size === 0)}
              onClick={handleImport}
              className="py-4 px-8 text-sm font-black tracking-widest uppercase bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowRight className="w-4 h-4"/>}
              {t('workspaceCenter.importSelected', 'Import Selected Assets')} ({selectedProfiles.size + selectedRunbooks.size})
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
};
