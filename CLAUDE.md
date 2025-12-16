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
- `src/App.tsx` - Main app component with version constant, Trimble user auth
- `src/components/MainMenu.tsx` - Main menu with inspection type selection
- `src/components/InspectorScreen.tsx` - Main inspection logic
- `src/supabase.ts` - Database types and client

### Authentication (v2.1.0+)
- **NO PIN code** - Uses Trimble Connect user email for authentication
- User's email must exist in `trimble_ex_users` table (column: `user_email`)
- User initials (e.g., "S.V") shown in header from Trimble Connect firstName/lastName
- If user not in table, shows "Ligipääs keelatud" (Access denied) screen

### Database Tables
1. `trimble_ex_users` - Authorized users
   - `id` - UUID primary key
   - `user_email` - Trimble Connect user email (UNIQUE)
   - `name` - Optional display name
   - `role` - 'inspector' | 'admin' | 'viewer'

2. `inspections` - Inspection records

### Inspection Modes
- **Paigaldatud detailide inspektsioon** - Assembly selection ON, uses Cast_unit_Mark
- **Poltide inspektsioon** - Assembly selection OFF, uses Tekla_Bolt.Bolt_Name
- Other modes: Muu, Mitte vastavus, Värviparandus, Keevis, etc. (developing)

### Tekla Properties Saved
Each inspection saves these Tekla properties:
- `file_name` - Model file name
- `guid`, `guid_ifc`, `guid_ms` - Object identifiers
- `object_id` - Object ID
- `cast_unit_bottom_elevation`, `cast_unit_top_elevation`
- `cast_unit_position_code`
- `cast_unit_weight`
- `assembly_mark` (Cast_unit_Mark OR Bolt_Name depending on mode)
- `product_name` - From Property Set "Product" > "Name"

### Database
Run `supabase-update.sql` when:
- Adding new columns to the inspections table
- Creating the `trimble_ex_users` table (new in v2.1.0)
