import logoUrl from '../assets/logo.png';
import { useBrand } from '../lib/queries';

/** Logo da loja: a enviada em Ajustes ou, sem ela, a logo do Bar do Guto que vem com o sistema. */
export function Logo({ size = 34 }: { size?: number }) {
  const brand = useBrand();
  const src = brand.data?.logoUrl || logoUrl;
  return <img className="logo-img" src={src} width={size} height={size} alt="" aria-hidden style={{ objectFit: 'contain' }} />;
}
