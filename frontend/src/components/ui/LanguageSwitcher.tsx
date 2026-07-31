import { useTranslation } from "react-i18next";
import { Select } from "./Select";
import "flag-icons/css/flag-icons.min.css";

// handle lang switch
export const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  const currentLang = i18n.language || "km";

  const options = [
    {
      value: "km",
      label: t("language.km"),
      icon: <span className="fi fi-kh text-lg rounded-sm overflow-hidden" />,
    },
    {
      value: "en",
      label: t("language.en"),
      icon: <span className="fi fi-us text-lg rounded-sm overflow-hidden" />,
    },
  ];

  return (
    <div className="w-36">
      <Select
        value={currentLang}
        onChange={handleLanguageChange}
        options={options}
        aria-label="Select language"
      />
    </div>
  );
};

