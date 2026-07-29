import { useTranslation } from "react-i18next";
import { DropdownMenu } from "./dropdown-menu";

export const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const currentLang = i18n.language || "km";

  const options = [
    {
      label: t("language.km"),
      onClick: () => handleLanguageChange("km"),
      Icon: <span className="fi fi-kh text-lg" />,
    },
    {
      label: t("language.en"),
      onClick: () => handleLanguageChange("en"),
      Icon: <span className="fi fi-us text-lg" />,
    },
  ];

  return (
    <DropdownMenu options={options}>
      <div className="flex items-center gap-2 font-medium">
        <span
          className={`fi ${currentLang === "en" ? "fi-us" : "fi-kh"} text-lg`}
        />
        <span className="hidden sm:inline">
          {currentLang === "en" ? t("language.en") : t("language.km")}
        </span>
      </div>
    </DropdownMenu>
  );
};
