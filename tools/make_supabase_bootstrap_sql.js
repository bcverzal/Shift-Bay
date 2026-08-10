function usage() {
  console.log("Usage:");
  console.log("  node tools/make_supabase_bootstrap_sql.js --location \"Machine Shed Pewaukee\" --timezone America/Chicago");
  console.log("  node tools/make_supabase_bootstrap_sql.js --location-id UUID --user-id UUID --role owner");
}

function argsToObject(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function sqlString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function main() {
  const args = argsToObject(process.argv.slice(2));
  if (args.location) {
    const timezone = args.timezone || "America/Chicago";
    console.log("-- Create first Shift Bay location");
    console.log("insert into public.locations (name, timezone)");
    console.log(`values (${sqlString(args.location)}, ${sqlString(timezone)})`);
    console.log("returning id;");
    return;
  }
  if (args["location-id"] && args["user-id"]) {
    const role = args.role || "owner";
    console.log("-- Link Supabase auth user to Shift Bay location");
    console.log("insert into public.location_users (location_id, user_id, role)");
    console.log(`values (${sqlString(args["location-id"])}, ${sqlString(args["user-id"])}, ${sqlString(role)});`);
    return;
  }
  usage();
  process.exit(1);
}

main();
