const RAW = [
  'http://fjvqcesf:15qp56smk66t@31.59.20.176:6754',
  'http://fjvqcesf:15qp56smk66t@45.38.107.97:6014',
  'http://fjvqcesf:15qp56smk66t@64.137.96.74:6641',
  'http://fjvqcesf:15qp56smk66t@198.23.243.226:6361',
  'http://fjvqcesf:15qp56smk66t@38.154.185.97:6370',
  'http://fjvqcesf:15qp56smk66t@84.247.60.125:6095',
  'http://fjvqcesf:15qp56smk66t@142.111.67.146:5611',
  'http://fjvqcesf:15qp56smk66t@31.58.9.4:6077',
  'http://fjvqcesf:15qp56smk66t@191.96.254.138:6185',
  'http://fjvqcesf:15qp56smk66t@198.46.161.42:5092'
];

let cursor = 0;

function nextProxy() {
  const proxy = RAW[cursor % RAW.length];
  cursor++;
  return proxy;
}

function allProxies() {
  return RAW;
}

module.exports = { nextProxy, allProxies };
