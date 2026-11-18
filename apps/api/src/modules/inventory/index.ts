/**
 * Öffentliche Schnittstelle des Bestandsmoduls.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { Product, ProductUnit, StockBooking, StockCount, StockCountLine, StockItem, StockReservation } from './entities/inventory.entities.js';

export { InventoryModule } from './inventory.module.js';
export { availableOf, InventoryService, type ReceiveInput, type ShippedContent } from './application/inventory.service.js';
export { Product, StockItem, StockReservation };

export const inventoryEntities = [Product, ProductUnit, StockItem, StockBooking, StockReservation, StockCount, StockCountLine];
