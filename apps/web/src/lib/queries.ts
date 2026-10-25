import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { MenuCategory, Neighborhood, Order } from './types';

export const useMenu = () => useQuery({ queryKey: ['menu'], queryFn: () => get<MenuCategory[]>('/api/menu'), staleTime: 60000 });
export const useNeighborhoods = () => useQuery({ queryKey: ['neighborhoods'], queryFn: () => get<Neighborhood[]>('/api/neighborhoods'), staleTime: 60000 });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get<any>('/api/settings'), staleTime: 60000 });
export const useDay = () => useQuery({ queryKey: ['day'], queryFn: () => get<{ day: any; cash: any }>('/api/day') });
export const useOrder = (id: string | null | undefined) =>
  useQuery({ queryKey: ['order', id], queryFn: () => get<Order>(`/api/orders/${id}`), enabled: !!id });
