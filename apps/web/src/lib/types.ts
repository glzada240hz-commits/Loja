import type { DeliveryStatus, KitchenStatus, OrderStage, OrderStatus, OrderType, PaymentMethod } from '@guto/core';

export interface MenuOption { id: string; name: string; priceCents: number; costCents: number | null; available: boolean }
export interface MenuGroup { id: string; name: string; minSelect: number; maxSelect: number; options: MenuOption[] }
export interface MenuVariant { id: string; name: string; priceCents: number; costCents: number | null; available: boolean }
export interface MenuProduct {
  id: string; categoryId: string; code: string | null; name: string; description: string | null; imagePath: string | null;
  kind: 'simple' | 'combo'; available: boolean; showOnline: boolean; sort: number;
  variants: MenuVariant[]; groups: MenuGroup[]; combo: { variantId: string; quantity: number; label: string }[];
}
export interface MenuCategory { id: string; name: string; sort: number; sendToKitchen: boolean; products: MenuProduct[] }

export interface CartLine {
  key: string;
  variantId: string;
  productName: string;
  variantName: string | null;
  unitPriceCents: number;
  options: { optionId: string; name: string; priceCents: number; quantity: number }[];
  quantity: number;
  notes: string;
}

export interface OrderItem {
  id: string; productName: string; variantName: string | null; categoryName: string | null; quantity: number;
  unitPriceCents: number; optionsUnitCents: number; totalCents: number; notes: string | null; status: 'active' | 'cancelled';
  cancelReason: string | null; ticketId: string | null; sentAt: string | null; sendToKitchen: boolean;
  options: { id: string; groupName: string; optionName: string; priceCents: number; quantity: number }[];
}
export interface Payment {
  id: string; method: PaymentMethod; amountCents: number; tenderedCents: number | null; changeCents: number; status: 'confirmed' | 'refunded';
  payerLabel: string | null; createdAt: string; userName: string | null; refundReason: string | null;
}
export interface OrderEvent { id: number; type: string; data: any; createdAt: string; userName: string | null; authorizedByName: string | null }
export interface Ticket { id: string; round: number; status: KitchenStatus; createdAt: string; startedAt: string | null; readyAt: string | null; changeNote: string | null }
export interface Order {
  id: string; number: number; businessDayId: string; type: OrderType; source: 'pos' | 'online' | 'whatsapp'; status: OrderStatus; stage: OrderStage;
  tableLabel: string | null; customerId: string | null; customerName: string | null; customerPhone: string | null;
  addrStreet: string | null; addrNumber: string | null; addrComplement: string | null; addrReference: string | null; neighborhoodId: string | null; neighborhoodName: string | null;
  notes: string | null; subtotalCents: number; discountType: 'amount' | 'percent' | null; discountValue: number | null; discountCents: number; discountReason: string | null;
  deliveryFeeCents: number; totalCents: number; paidCents: number; balanceCents: number; paymentIntent: PaymentMethod | null; changeForCents: number | null;
  etaAt: string | null; receivable: boolean; trackingToken: string | null; waOptIn: boolean;
  courierId: string | null; courierName: string | null; deliveryStatus: DeliveryStatus | null; deliveryIssue: string | null; courierFeeCents: number | null;
  createdAt: string; acceptedAt: string | null; readyAt: string | null; dispatchedAt: string | null; deliveredAt: string | null; closedAt: string | null;
  cancelledAt: string | null; cancelReason: string | null; createdByName: string | null; version: number;
  items: OrderItem[]; payments: Payment[]; tickets: Ticket[]; events: OrderEvent[];
}
export interface OrderRow {
  id: string; number: number; type: OrderType; source: string; status: OrderStatus; stage: OrderStage; tableLabel: string | null;
  customerName: string | null; customerPhone: string | null; addrStreet: string | null; addrNumber: string | null; neighborhoodName: string | null;
  totalCents: number; paidCents: number; receivable: boolean; deliveryStatus: DeliveryStatus | null; courierName: string | null; createdAt: string;
  etaAt: string | null; version: number; referenceDate: string;
}
export interface Neighborhood { id: string; name: string; feeCents: number; courierFeeCents: number | null; minOrderCents: number; etaMinutes: number; active: boolean }
