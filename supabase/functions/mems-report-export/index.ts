import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { createExportHandler } from "./handler.mjs";
Deno.serve(createExportHandler({createClient,env:(name:string)=>Deno.env.get(name)!}));
