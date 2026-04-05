import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller } } = await supabaseUser.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Only managers can seed demo data");

    const summary: string[] = [];

    // --- 1. Demo Manager user ---
    const managerEmail = "demo.manager@appliednutrition.uk";
    const { data: existingManager } = await supabaseAdmin.auth.admin.listUsers();
    const managerExists = existingManager?.users?.some((u: any) => u.email === managerEmail);

    let managerId: string | null = null;
    if (managerExists) {
      managerId = existingManager!.users!.find((u: any) => u.email === managerEmail)!.id;
      summary.push("Manager user already exists");
    } else {
      const { data: newManager, error: mErr } = await supabaseAdmin.auth.admin.createUser({
        email: managerEmail,
        password: "DemoPass123!",
        email_confirm: true,
        user_metadata: { name: "Demo Manager" },
      });
      if (mErr) throw mErr;
      managerId = newManager.user!.id;

      // Assign admin role
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles").select("id").eq("user_id", managerId).single();
      if (!existingRole) {
        await supabaseAdmin.from("user_roles").insert({ user_id: managerId, role: "admin" });
      }
      summary.push("Created demo Manager user");
    }

    // --- 2. Demo Engineer user ---
    const engineerEmail = "demo.engineer@appliednutrition.uk";
    const engineerExists = existingManager?.users?.some((u: any) => u.email === engineerEmail);

    let engineerId: string | null = null;
    if (engineerExists) {
      engineerId = existingManager!.users!.find((u: any) => u.email === engineerEmail)!.id;
      summary.push("Engineer user already exists");
    } else {
      const { data: newEngineer, error: eErr } = await supabaseAdmin.auth.admin.createUser({
        email: engineerEmail,
        password: "DemoPass123!",
        email_confirm: true,
        user_metadata: { name: "Demo Engineer" },
      });
      if (eErr) throw eErr;
      engineerId = newEngineer.user!.id;

      const { data: existingRole } = await supabaseAdmin
        .from("user_roles").select("id").eq("user_id", engineerId).single();
      if (!existingRole) {
        await supabaseAdmin.from("user_roles").insert({ user_id: engineerId, role: "engineer" });
      }
      summary.push("Created demo Engineer user");
    }

    // --- 3. Demo Engineer identity (PIN table) ---
    const { data: existingEng } = await supabaseAdmin
      .from("engineers").select("id").eq("name", "Demo Engineer").single();

    let demoEngineerId: string;
    if (existingEng) {
      demoEngineerId = existingEng.id;
      summary.push("Demo Engineer identity already exists");
    } else {
      // Use set_engineer_pin_standalone after insert
      const { data: newEng, error: engErr } = await supabaseAdmin
        .from("engineers")
        .insert({ name: "Demo Engineer", pin_hash: "temp", is_active: true })
        .select("id")
        .single();
      if (engErr) throw engErr;
      demoEngineerId = newEng.id;

      await supabaseAdmin.rpc("set_engineer_pin_standalone", {
        _engineer_id: demoEngineerId,
        _new_pin: "1234",
      });
      summary.push("Created Demo Engineer identity (PIN: 1234)");
    }

    // --- 4. Problem descriptions ---
    const problems = [
      { name: "Motor Overheating", category: "Electrical", severity: "high", description: "Motor temperature exceeds safe operating range", active: true },
      { name: "Conveyor Belt Misalignment", category: "Mechanical", severity: "medium", description: "Belt tracking off center causing product jams", active: true },
    ];

    const problemIds: string[] = [];
    for (const prob of problems) {
      const { data: existing } = await supabaseAdmin
        .from("problem_descriptions").select("id").eq("name", prob.name).single();
      if (existing) {
        problemIds.push(existing.id);
      } else {
        const { data: created, error } = await supabaseAdmin
          .from("problem_descriptions").insert(prob).select("id").single();
        if (error) throw error;
        problemIds.push(created.id);
        summary.push(`Created problem: ${prob.name}`);
      }
    }

    // --- 5. Checklists ---
    const checklistDefs = [
      // Problem 1 checklists
      { problem_description_id: problemIds[0], description: "Verify motor is powered off before inspection", type: "Safety", is_required: true },
      { problem_description_id: problemIds[0], description: "Check cooling fan operation", type: "Quality", is_required: true },
      { problem_description_id: problemIds[0], description: "Record motor temperature reading", type: "Quality", is_required: false },
      // Problem 2 checklists
      { problem_description_id: problemIds[1], description: "Lock out conveyor power supply", type: "Safety", is_required: true },
      { problem_description_id: problemIds[1], description: "Inspect belt tension and rollers", type: "Quality", is_required: true },
      { problem_description_id: problemIds[1], description: "Clean debris from belt path", type: "Quality", is_required: false },
    ];

    for (const cl of checklistDefs) {
      const { data: existing } = await supabaseAdmin
        .from("checklists")
        .select("id")
        .eq("problem_description_id", cl.problem_description_id)
        .eq("description", cl.description)
        .single();
      if (!existing) {
        await supabaseAdmin.from("checklists").insert(cl);
        summary.push(`Created checklist: ${cl.description.substring(0, 40)}...`);
      }
    }

    // --- 6. Get existing machine and products for WOs ---
    const { data: machines } = await supabaseAdmin.from("machines").select("name").limit(1);
    const machineName = machines?.[0]?.name ?? "Demo Machine";

    const { data: productsList } = await supabaseAdmin.from("products").select("id").limit(2);

    // --- 7. Work Orders ---
    const now = new Date();
    const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();

    // Check for existing demo WOs
    const { data: existingWOs } = await supabaseAdmin
      .from("work_orders")
      .select("id")
      .eq("requester_name", "Demo Operator")
      .limit(1);

    if (existingWOs && existingWOs.length > 0) {
      summary.push("Demo Work Orders already exist");
    } else {
      // WO 1: Open
      const { error: wo1Err } = await supabaseAdmin.from("work_orders").insert({
        machine: machineName,
        description: problems[0].name,
        requester_name: "Demo Operator",
        operator_id: managerId!,
        priority: "high",
        status: "open",
        created_at: h(2),
      });
      if (wo1Err) throw wo1Err;
      summary.push("Created WO (open)");

      // WO 2: In Progress
      const { data: wo2, error: wo2Err } = await supabaseAdmin.from("work_orders").insert({
        machine: machineName,
        description: problems[1].name,
        requester_name: "Demo Operator",
        operator_id: managerId!,
        priority: "medium",
        status: "in_progress",
        created_at: h(4),
        received_at: h(3.8),
        arrived_at: h(3.5),
        started_at: h(3),
        engineer_id: demoEngineerId,
        engineer_name: "Demo Engineer",
      }).select("id").single();
      if (wo2Err) throw wo2Err;
      summary.push("Created WO (in_progress)");

      // WO 3: Finished (printable)
      const { data: wo3, error: wo3Err } = await supabaseAdmin.from("work_orders").insert({
        machine: machineName,
        description: problems[0].name,
        requester_name: "Demo Operator",
        operator_id: managerId!,
        priority: "critical",
        status: "finished",
        created_at: h(8),
        received_at: h(7.5),
        arrived_at: h(7),
        started_at: h(6.5),
        finished_at: h(5),
        engineer_id: demoEngineerId,
        engineer_name: "Demo Engineer",
        signed_by_name: "Demo Engineer",
        checklist_completed: true,
        notes: "Replaced cooling fan motor bearing. Temperature returned to normal range.",
      }).select("id").single();
      if (wo3Err) throw wo3Err;
      summary.push("Created WO (finished — printable)");

      // --- 8. Parts Used on completed WO ---
      if (productsList && productsList.length > 0 && wo3) {
        for (const product of productsList.slice(0, 2)) {
          await supabaseAdmin.from("parts_used").insert({
            work_order_id: wo3.id,
            product_id: product.id,
            engineer_id: engineerId!,
            quantity: 1,
          });
        }
        summary.push(`Linked ${Math.min(productsList.length, 2)} parts to finished WO`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      summary,
      credentials: {
        manager: { email: managerEmail, password: "DemoPass123!" },
        engineer: { email: engineerEmail, password: "DemoPass123!" },
        engineerPin: "1234",
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
