export type HAConfig = { haHost:string; haToken:string; mqttBroker?:string; mqttUser?:string; mqttPass?:string };
export function getHAConfig(): HAConfig {
  const host = process.env.HA_HOST;
  const token = process.env.HA_TOKEN;
  if(!host) throw new Error('HA_HOST required');
  if(!token) throw new Error('HA_TOKEN required');
  return { haHost: host, haToken: token, mqttBroker: process.env.MQTT_BROKER, mqttUser: process.env.MQTT_USER, mqttPass: process.env.MQTT_PASS };
}
