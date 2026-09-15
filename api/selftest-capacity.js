import { alignOfferCapacity } from './research.js';

export default function handler(req, res) {
  const source = { url: 'https://example.com/item', title: 'example.com' };
  const mixed = { offers: [
    { seller:'A', productName:'Galaxy S25 Ultra 256GB', priceKRW:1698400, note:'256GB', sources:[source] },
    { seller:'B', productName:'Galaxy S25 Ultra 512GB', priceKRW:1841400, note:'512GB', sources:[source] }
  ]};
  const onePlusAmbiguous = { offers: [
    { seller:'A', productName:'Galaxy S25 Ultra 256GB', priceKRW:1698400, note:'256GB', sources:[source] },
    { seller:'B', productName:'Galaxy S25 Ultra', priceKRW:1500000, note:'', sources:[source] }
  ]};
  const ordinary = { offers: [
    { seller:'A', productName:'MX Keys Mini', priceKRW:129000, note:'', sources:[source] },
    { seller:'B', productName:'MX Keys Mini', priceKRW:149000, note:'', sources:[source] }
  ]};

  const a = alignOfferCapacity(mixed, { productName:'Galaxy S25 Ultra' });
  const b = alignOfferCapacity(mixed, { productName:'Galaxy S25 Ultra 256GB' });
  const c = alignOfferCapacity(onePlusAmbiguous, { productName:'Galaxy S25 Ultra' });
  const d = alignOfferCapacity(ordinary, { productName:'MX Keys Mini' });
  const ok = a.optionRequired === true && a.variants.length === 2 &&
    b.optionRequired === false && b.payload.offers.length === 1 && b.payload.offers[0].productName.includes('256GB') &&
    c.optionRequired === false && c.payload.offers.length === 1 && c.payload.offers[0].productName.includes('256GB') &&
    d.optionRequired === false && d.payload.offers.length === 2;

  res.status(ok ? 200 : 500).json({ ok, mixedBlocked:a.optionRequired, requested256Count:b.payload.offers.length, ambiguousRemoved:c.payload.offers.length, ordinaryCount:d.payload.offers.length });
}
