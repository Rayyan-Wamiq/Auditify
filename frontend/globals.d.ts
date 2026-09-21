// Ambient declarations for side-effect imports that TypeScript >= 6.0 no
// longer accepts without an explicit module type (error ts2882), e.g. the
// global stylesheet imported in app/layout.tsx.
declare module "*.css";