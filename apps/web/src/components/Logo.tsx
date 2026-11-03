import iconUrl from '../assets/icon.svg';
import { useBrand } from '../lib/queries';

/** Logo da loja (enviada em Ajustes); sem logo, o ícone padrão. */
export function Logo({ size = 34 }: { size?: number }) {
  const brand = useBrand();
  const src = brand.data?.logoUrl;
  if (src) return <img className="logo-img" src={src} width={size} height={size} alt="" aria-hidden style={{ objectFit: 'contain' }} />;
  return <img src={iconUrl} width={size} height={size} alt="" aria-hidden />;
}
