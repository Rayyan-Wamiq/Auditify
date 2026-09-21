// Ambient declarations for side-effect imports that TypeScript >= 6.0 no
// longer accepts without an explicit module type (error ts2882), e.g. the
// global stylesheet imported in app/layout.tsx.
declare module "*.css";

// Raw SQL is bundled as a string (see the `asset/source` webpack rule for
// `.sql` in next.config.js) so `lib/server/db.ts` can apply `db/schema.sql`
// without any filesystem access at runtime - which is what makes the schema
// bootstrap work unchanged on serverless deployments.
declare module "@/db/schema.sql" {
  const content: string;
  export default content;
}
