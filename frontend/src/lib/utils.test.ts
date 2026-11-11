import { labToHex } from './utils';

describe('labToHex', () => {
  it('converts reference colours', () => {
    expect(labToHex([100, 0, 0])).toBe('#ffffff');
    expect(labToHex([0, 0, 0])).toBe('#000000');
    expect(labToHex([53.24, 80.09, 67.2])).toBe('#ff0000');
  });
});
