import {
  DELIVERY_STATUS_LABEL,
  ORDER_STAGE_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_TYPE_LABEL,
  placeLabel,
  type DeliveryStatus,
  type OrderStage,
  type OrderStatus,
  type OrderType,
} from '@guto/core';

const statusColor: Record<OrderStatus, string> = { pending: 'orange', open: 'blue', closed: 'green', cancelled: 'red' };
const stageColor: Record<OrderStage, string> = { received: '', preparing: 'yellow', ready: 'green', out_for_delivery: 'blue', delivered: 'dark' };
const deliveryColor: Record<DeliveryStatus, string> = { waiting: '', en_route: 'blue', delivered: 'green', issue: 'red' };

export const StatusBadge = ({ status }: { status: OrderStatus }) => <span className={'badge ' + statusColor[status]}>{ORDER_STATUS_LABEL[status]}</span>;
export const StageBadge = ({ stage }: { stage: OrderStage }) => <span className={'badge ' + stageColor[stage]}>{ORDER_STAGE_LABEL[stage]}</span>;
export const DeliveryBadge = ({ status }: { status: DeliveryStatus }) => <span className={'badge ' + deliveryColor[status]}>{DELIVERY_STATUS_LABEL[status]}</span>;
export const TypeBadge = ({ type, table, tabKind }: { type: OrderType; table?: string | null; tabKind?: 'table' | 'tab' | null }) => (
  <span className="badge">{type === 'table' && table ? placeLabel({ type, tabKind, tableLabel: table }) : ORDER_TYPE_LABEL[type]}</span>
);
