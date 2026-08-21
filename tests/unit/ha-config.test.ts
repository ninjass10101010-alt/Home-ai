import { getHAConfig } from '../../src/lib/ha/config';
test('config requires HA_HOST and HA_TOKEN', () => {
  process.env.HA_HOST = '';
  expect(() => getHAConfig()).toThrow('HA_HOST required');
});
