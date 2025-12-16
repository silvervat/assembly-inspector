# Assembly Inspector - Claude Memory

## Version Management

**IMPORTANT:** When making changes to this project, always update the version number in TWO places:

1. `src/App.tsx` - Update `APP_VERSION` constant
2. `package.json` - Update `version` field

Keep both versions in sync!

### Version Format
Use semantic versioning: `MAJOR.MINOR.PATCH`
- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

## Project Overview

This is a Trimble Connect extension for quality control inspection of assemblies.

### Key Technologies
- React 18 + TypeScript
- Vite build system
- Trimble Connect Workspace API (v0.3.33)
- Supabase for backend/database
- GitHub Pages deployment

### Important Files
- `src/App.tsx` - Main app component with version constant
- `src/components/InspectorScreen.tsx` - Main inspection logic
- `src/components/LoginScreen.tsx` - PIN authentication
- `src/supabase.ts` - Database types and client

### Tekla Properties Saved
Each inspection saves these Tekla properties:
- `file_name` - Model file name
- `guid`, `guid_ifc`, `guid_ms` - Object identifiers
- `object_id` - Object ID
- `cast_unit_bottom_elevation`, `cast_unit_top_elevation`
- `cast_unit_position_code`
- `cast_unit_weight`
- `assembly_mark` (Cast_unit_Mark)
- `product_name` - From Property Set "Product" > "Name"

### Database
Run `supabase-update.sql` when adding new columns to the inspections table.
