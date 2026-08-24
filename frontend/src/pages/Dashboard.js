import React from "react";
import { Card, CardHeader, CardContent } from "components/ui/card";
import brand from "lib/brand";
import { useI18n } from "i18n";

export default function Dashboard() {
  const { t, tf } = useI18n();

  return (
    <div className="w-full animate-fade-in">
      <h1 className="text-2xl font-bold tracking-tight mb-6">{t("dashboard.title")}</h1>
      <Card className="w-full">
        <CardHeader>
          <h2 className="text-lg font-semibold">
            {tf("dashboard.welcome", { brand: brand.name })}
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
