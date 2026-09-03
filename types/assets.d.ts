/**
 * TypeScript 6 with `moduleResolution: bundler` does not pick up Next's ambient
 * stylesheet declarations for side-effect imports, so we declare them here.
 */
declare module '*.css';
declare module '*.scss';
