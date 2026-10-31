import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui';

/**
 * Nova versão do sistema instalada no servidor: avisa sem interromper (antes era um confirm() que travava a tela).
 * Rascunhos do atendente ficam no aparelho e sobrevivem à atualização.
 */
export function UpdateBanner() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => {
    const on = (e: Event) => setApply(() => (e as CustomEvent<() => void>).detail);
    window.addEventListener('guto:update', on);
    return () => window.removeEventListener('guto:update', on);
  }, []);
  if (!apply) return null;
  return (
    <div className="update-banner" role="status">
      <RefreshCw size={16} aria-hidden /> Nova versão do sistema disponível.
      <Button size="sm" onClick={() => apply()}>
        Atualizar agora
      </Button>
    </div>
  );
}
