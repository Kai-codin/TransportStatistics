'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Search, ChevronDown, Check, X } from 'lucide-react';

interface RelationDropdownProps {
  relationConfig: { queryPath: string; labelField: string };
  value: string;
  onChange: (val: string) => void;
}

export function RelationDropdown({ relationConfig, value, onChange }: RelationDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dynamic API path resolution
  const pathSegments = relationConfig.queryPath.split('.');
  let queryApi: any = api;
  for (const segment of pathSegments) {
    if (queryApi) queryApi = queryApi[segment];
  }

  const rawOptions = useQuery(queryApi) as Record<string, any>[] | undefined;

  // Handle clicking outside to collapse the menu panel
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sort and Filter data operations
  const processedOptions = useMemo(() => {
    if (!rawOptions) return [];

    // 1. Sort alphabetically based on the designated label layout field
    const sorted = [...rawOptions].sort((a, b) => {
      const labelA = String(a[relationConfig.labelField] || '').toLowerCase();
      const labelB = String(b[relationConfig.labelField] || '').toLowerCase();
      return labelA.localeCompare(labelB);
    });

    // 2. Filter options matching user search term string input
    if (!searchTerm.trim()) return sorted;
    return sorted.filter((opt) =>
      String(opt[relationConfig.labelField] || '')
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  }, [rawOptions, searchTerm, relationConfig.labelField]);

  // Find currently active choice object match
  const selectedOption = useMemo(() => {
    return rawOptions?.find((opt) => opt._id === value);
  }, [rawOptions, value]);

  if (rawOptions === undefined) {
    return (
      <div className="h-10 flex items-center px-3 text-xs text-ts-text-3 bg-ts-surface-2 border border-ts-border rounded-xl">
        Loading target listings...
      </div>
    );
  }

  return (
    <div className="relative ref-wrapper" ref={dropdownRef}>
      {/* Target Input Window Interactive Display Box */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="h-10 border border-ts-border rounded-xl bg-ts-surface-2 px-3 flex items-center justify-between text-sm text-ts-text-1 cursor-pointer select-none focus-within:border-ts-accent focus-within:ring-1 focus-within:ring-ts-accent-glow transition"
      >
        <span className={selectedOption ? 'text-ts-text-1' : 'text-ts-text-3 font-medium'}>
          {selectedOption ? String(selectedOption[relationConfig.labelField]) : '-- Unassigned / None --'}
        </span>
        <div className="flex items-center gap-1.5 text-ts-text-3">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-1 hover:text-ts-danger rounded-md transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Floating Panel Shell Overlay Container */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 border border-ts-border rounded-2xl bg-ts-surface shadow-xl max-h-64 flex flex-col overflow-hidden animate-in fade-in-50 slide-in-from-top-1 duration-150">
          
          {/* Inner Search Box Header */}
          <div className="p-2 border-b border-ts-border bg-ts-surface flex items-center gap-2">
            <Search className="w-4 h-4 text-ts-text-3 ml-2 flex-shrink-0" />
            <input
              type="text"
              autoFocus
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-sm text-ts-text-1 focus:outline-none py-1.5 pr-2"
            />
          </div>

          {/* Interactive Options List Content Area */}
          <div className="overflow-y-auto flex-1 py-1 bg-ts-surface">
            {/* Direct Empty/None Option Variant */}
            <div
              onClick={() => {
                onChange('');
                setIsOpen(false);
                setSearchTerm('');
              }}
              className={`px-3 py-2.5 text-sm cursor-pointer transition flex items-center justify-between ${
                !value ? 'bg-ts-accent-light text-ts-accent font-semibold' : 'text-ts-text-3 hover:bg-ts-surface-2'
              }`}
            >
              <span>-- Unassigned / None --</span>
              {!value && <Check className="w-4 h-4 text-ts-accent" />}
            </div>

            {processedOptions.length === 0 ? (
              <div className="px-4 py-3 text-xs text-ts-text-3 text-center">
                No matching directory values found
              </div>
            ) : (
              processedOptions.map((opt) => {
                const isSelected = opt._id === value;
                const displayLabel = String(opt[relationConfig.labelField] || opt._id);

                return (
                  <div
                    key={opt._id}
                    onClick={() => {
                      onChange(opt._id);
                      setIsOpen(false);
                      setSearchTerm('');
                    }}
                    className={`px-3 py-2.5 text-sm cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-ts-accent-light text-ts-accent font-semibold'
                        : 'text-ts-text-1 hover:bg-ts-surface-2'
                    }`}
                  >
                    <span className="truncate pr-4">{displayLabel}</span>
                    {isSelected && <Check className="w-4 h-4 flex-shrink-0 text-ts-accent" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}