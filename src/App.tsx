import React from 'react';
import { ModelConfigModal } from './components/ModelConfigModal';
import { AgentWorkbench } from './components/AgentWorkbench';
import { SeriesProvider } from './contexts/SeriesContext';
import { useModelConfig } from './hooks/useModelConfig';
import { useLocalization } from './hooks/useLocalization';

export default function App(): React.ReactElement {
  return (
    <SeriesProvider>
      <AppInner />
    </SeriesProvider>
  );
}

function AppInner(): React.ReactElement {
  const { language, setLanguage } = useLocalization();
  const { config, updateConfig, isModalOpen, setIsModalOpen, saveToServer, isLoading: isModelConfigLoading, error: modelConfigError, clearError } = useModelConfig();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <AgentWorkbench
        language={language}
        setLanguage={setLanguage}
        onOpenModelConfig={() => setIsModalOpen(true)}
      />
      <ModelConfigModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); clearError(); }}
        config={config}
        onChange={updateConfig}
        onSave={saveToServer}
        isLoading={isModelConfigLoading}
        error={modelConfigError}
      />
    </div>
  );
}