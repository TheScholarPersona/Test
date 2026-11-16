/**
 * Öffentliche Schnittstelle des Bestandsmoduls.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { Product, StockBooking, StockItem } from './entities/inventory.entities.js';

export { InventoryModule } from './inventory.module.js';
export { InventoryService, type ReceiveInput } from './application/inventory.service.js';
export { Product, StockItem };

export const inventoryEntities = [Product, StockItem, StockBooking];
