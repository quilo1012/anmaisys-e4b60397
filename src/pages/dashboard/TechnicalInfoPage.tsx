import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, BookOpen, ExternalLink, FileText } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { padRow } from "@/lib/technicalInfo";
import { technicalDocUrl, useTechnicalTopic, useTechnicalTopics } from "@/hooks/useTechnicalInfo";

/** Where a scanned QR label lands: the topic's information, read-only, on any device. */
export default function TechnicalInfoPage() {
  const { id } = useParams<{ id?: string }>();
  const { data: topics = [] } = useTechnicalTopics();
  const { data: topic, isLoading } = useTechnicalTopic(id);
  const [docUrl, setDocUrl] = useState<string | null>(null);

  useEffect(() => {
    if (topic?.kind === "pdf" && topic.file_path) {
      technicalDocUrl(topic.file_path).then(setDocUrl).catch(() => setDocUrl(null));
    }
  }, [topic?.id, topic?.kind, topic?.file_path]);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/dashboard/engineer">
            <ArrowLeft className="h-4 w-4" /> Engineer Console
          </Link>
        </Button>

        {!id ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" /> Technical Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topics.map((t) => (
                <Button key={t.id} asChild variant="outline" className="w-full justify-start">
                  <Link to={`/dashboard/technical-info/${t.id}`}>{t.title}</Link>
                </Button>
              ))}
              {topics.length === 0 && <p className="text-sm text-muted-foreground">No topics yet.</p>}
            </CardContent>
          </Card>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !topic ? (
          <p className="text-muted-foreground">This information no longer exists.</p>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" /> {topic.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {topic.kind === "table" ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {topic.columns.map((c, i) => (
                          <TableHead key={i}>{c}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topic.rows.map((r, ri) => (
                        <TableRow key={ri}>
                          {padRow(r, topic.columns.length).map((c, ci) => (
                            <TableCell key={ci} className="text-base">
                              {c}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : docUrl ? (
                <div className="space-y-2">
                  <Button asChild variant="outline" className="gap-1">
                    <a href={docUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" /> Open document
                    </a>
                  </Button>
                  <iframe src={docUrl} title={topic.title} className="h-[70vh] w-full rounded-md border" />
                </div>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Preparing the document…
                </p>
              )}

              {topic.note && <p className="text-base font-semibold">{topic.note}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
