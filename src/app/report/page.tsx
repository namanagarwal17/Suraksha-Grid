import { ReportForm } from "@/components/reports/report-form";
export default function ReportPage() {
  return <div className="mx-auto max-w-xl space-y-4 p-4 lg:p-8"><div><h1 className="text-2xl font-bold">Add a report</h1><p className="text-sm text-muted">Takes about 10 seconds. Help others travel safer.</p></div><ReportForm /></div>;
}
