
-- Create checklists table for dynamic checklist items per problem
CREATE TABLE public.checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  problem_description_id UUID NOT NULL REFERENCES public.problem_descriptions(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'Safety',
  description TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create checklist_responses table for per-WO completion tracking
CREATE TABLE public.checklist_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL,
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_by UUID REFERENCES public.engineers(id),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(work_order_id, checklist_id)
);

-- Enable RLS
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;

-- Checklists policies
CREATE POLICY "Authenticated can view checklists"
  ON public.checklists FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage checklists"
  ON public.checklists FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Checklist responses policies
CREATE POLICY "Authenticated can view checklist_responses"
  ON public.checklist_responses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert checklist_responses"
  ON public.checklist_responses FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update checklist_responses"
  ON public.checklist_responses FOR UPDATE
  TO authenticated
  USING (true);

-- Indexes for performance
CREATE INDEX idx_checklists_problem ON public.checklists(problem_description_id);
CREATE INDEX idx_checklist_responses_wo ON public.checklist_responses(work_order_id);
CREATE INDEX idx_checklist_responses_checklist ON public.checklist_responses(checklist_id);
