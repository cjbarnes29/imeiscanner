import type { DeliveryPacket } from './retail/types';

/**
 * Page side of "your WhatsApp report is ready". On Android this posts a notification; one tap opens WhatsApp with the
 * message already filled in. The message is NEVER sent by the app: WhatsApp needs the person's own Send tap.
 * In a plain browser there is no bridge and nothing happens (the prepared message is in Home > Prepared reports & WhatsApp).
 */
export type WhatsAppBridge = { whatsappReady?: (destination: string, phone: string, text: string) => void };
const bridge = (): WhatsAppBridge | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { AndroidScanner?: WhatsAppBridge }).AndroidScanner);

/** Returns true when Android was asked to show the notification. Only for runs nobody is watching (routines, Autopilot). */
export function notifyWhatsAppReady(packet: Pick<DeliveryPacket, 'destination' | 'phone' | 'text' | 'status'> | undefined, target: WhatsAppBridge | undefined = bridge()): boolean {
  if (!packet || packet.status !== 'prepared' || !packet.text.trim() || !target?.whatsappReady) return false;
  try { target.whatsappReady(packet.destination, packet.phone, packet.text.slice(0, 20000)); return true; } catch { return false; }
}
