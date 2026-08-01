"use client";

import { useState } from "react";

type SearchBarProps = {
  onSearch: (artistName: string) => void;
  isLoading?: boolean;
};

export default function SearchBar({ onSearch, isLoading }: SearchBarProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSearch(trimmed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-xl gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="아티스트 또는 곡 제목을 검색해보세요 (예: 아이유, Blueming)"
        className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={isLoading}
        className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {isLoading ? "검색 중..." : "검색"}
      </button>
    </form>
  );
}
