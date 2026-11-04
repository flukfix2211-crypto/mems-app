const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'../..');
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function setup(){
 const db=new PGlite();await db.exec(`create schema auth;create schema private;create role authenticated;create role service_role;create role anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.mems_type_key(v text) returns text language sql immutable as $$select lower(btrim(v))$$;
 create table auth.users(id uuid primary key);create table user_profiles(id uuid primary key,active boolean,role text,permissions text[]);
 create table assets(id bigint primary key,no int,type text,asset_code text,asset_id text,serial_number text);
 insert into auth.users values('${actor}'),('${other}');insert into user_profiles values('${actor}',true,'user',array['pm_reports']),('${other}',true,'admin',array[]::text[]);
 insert into assets values(1,41,'C2','real-code','real-id','SN41'),(2,41,'Pump','pump-code','pump-id','P41');
 alter table user_profiles enable row level security;create policy own on user_profiles for select to authenticated using(id=auth.uid());
 grant usage on schema public,auth,private to authenticated;grant select on user_profiles,assets to authenticated;set request.jwt.claim.sub='${actor}';`);
 for(const file of ['20261028081412_pm_acceptance_reports.sql','20261028083412_pm_report_explicit_grants.sql','20261104040109_pm_native_batch_reports.sql','20261104042536_pm_saved_operators.sql','20261104043729_pm_tool_type_catalog.sql','20261104044405_pm_confirmed_form_types.sql','20261104063433_pm_saved_brands_models.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 await db.exec('update mems_report_settings set enabled=true;set role authenticated');return db;
}
module.exports={setup,actor,other};
