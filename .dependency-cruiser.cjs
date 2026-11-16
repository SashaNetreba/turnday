/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-must-stay-pure',
      comment:
        'packages/domain is pure TypeScript (ADR 0001): no apps, no Prisma, no NestJS, no React, ' +
        'no Node built-ins. Talk to the outside world through ports. Do not weaken this rule.',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        path: [
          '^apps/',
          '(^|node_modules/)@turnday/(api|web)($|/)',
          '(^|node_modules/)(@prisma|@nestjs)/',
          '(^|node_modules/)(prisma|react|react-dom)($|/)',
        ],
      },
    },
    {
      name: 'domain-no-node-builtins',
      comment: 'packages/domain must not use Node built-ins (fs, http, path, node:*, …).',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.cjs', '.mjs', '.json'],
    },
  },
};
