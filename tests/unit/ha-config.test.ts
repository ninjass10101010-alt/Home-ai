import { getHAConfig } from '../../src/lib/ha/config';
test('config requires HA_HOST and HA_TOKEN', () => {
  process.env.HA_HOST = '';
  expect(() => getHAConfig()).toThrow('HA_HOST required');
});

test('config requires HA_TOKEN even when HA_HOST set', () => {
  process.env.HA_HOST = 'http://homeassistant:8123';
  process.env.HA_TOKEN = '';
  expect(() => getHAConfig()).toThrow('HA_TOKEN required');
});
