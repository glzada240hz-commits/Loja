import iconUrl from '../assets/icon.svg';

export function Logo({ size = 34 }: { size?: number }) {
  return <img src={iconUrl} width={size} height={size} alt="" aria-hidden />;
}
